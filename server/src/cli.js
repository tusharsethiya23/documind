#!/usr/bin/env node
/**
 * DocuMind CLI (Week 1: the core pipeline without the web UI).
 *
 *   npm run cli -- setup                  create the Atlas Vector Search index
 *   npm run cli -- ingest ./papers        index every PDF in a folder
 *   npm run cli -- docs                   list indexed documents
 *   npm run cli -- search "query"         retrieval only (no LLM call)
 *   npm run cli -- ask "question"         answer with citations
 *   npm run cli -- chat                   interactive Q&A
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { Document } from './models/Document.js';
import { deleteDocument, indexPdf } from './services/indexer.js';
import { getLLM, LLMError } from './services/llm.js';
import { pageLabel } from './services/prompts.js';
import {
  bestScore,
  finalize,
  generate,
  generateComparison,
  isAnswerable,
  REFUSAL,
  retrieve,
  retrieveForComparison,
} from './services/qa.js';
import { ensureSearchIndexes, searchIndexStatus } from './services/search.js';

const scoreLabel = (h) => {
  const vector = h.score == null ? '  —  ' : h.score.toFixed(3);
  const rerank = h.rerankScore == null ? '' : ` rerank ${h.rerankScore.toFixed(1)}`;
  return `${vector}${rerank} ${pc.dim(`(${h.matchedBy.join('+')})`)}`;
};

const pages = (h) => (h.pageStart === h.pageEnd ? `p. ${h.pageStart}` : `pp. ${pageLabel(h)}`);
const snippet = (text, n = 160) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
};
const toInt = (v) => Number.parseInt(v, 10);

async function collectPdfs(inputs) {
  const found = [];
  for (const input of inputs) {
    const stat = await fs.stat(input).catch(() => null);
    if (stat?.isDirectory()) {
      for (const entry of await fs.readdir(input, { recursive: true })) {
        if (entry.toLowerCase().endsWith('.pdf')) found.push(path.join(input, entry));
      }
    } else if (stat && input.toLowerCase().endsWith('.pdf')) {
      found.push(input);
    } else {
      console.log(pc.yellow(`Skipping ${input} (not a PDF or not found)`));
    }
  }
  return found.sort();
}

/** Run a command with a DB connection, printing friendly errors. */
const withDB = (fn) => async (...args) => {
  try {
    await connectDB();
    await fn(...args);
  } catch (err) {
    console.error(pc.red(err instanceof LLMError ? err.message : `Error: ${err.message}`));
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
};

async function answer(question, llm, { topK, documentIds, showContext, compare }) {
  let hits;
  let groups = null;
  if (compare) {
    if (!documentIds || new Set(documentIds).size < 2) throw new Error('--compare needs at least two --doc ids (see `docs`).');
    ({ hits, groups } = await retrieveForComparison(question, [...new Set(documentIds)]));
    for (const g of groups) {
      console.log(pc.dim(`${g.filename}: ${g.covered ? `${g.hits.length} passages` : 'does not cover this question'}`));
    }
  } else {
    hits = await retrieve(question, { topK, documentIds });
  }
  if (showContext) {
    hits.forEach((h, i) => console.log(pc.dim(`[${i + 1}] ${scoreLabel(h)} ${h.filename} ${pages(h)}`)));
  }
  if (groups ? !groups.some((g) => g.covered) : !isAnswerable(hits)) {
    const best = hits.length ? bestScore(hits).toFixed(2) : 'n/a';
    console.log(`\n${REFUSAL}`);
    console.log(pc.dim(`(No passage was relevant enough: best score ${best} < ${config.minScore})`));
    return;
  }

  process.stdout.write('\n');
  let text = '';
  for await (const part of groups ? generateComparison(question, groups, llm) : generate(question, hits, llm)) {
    text += part;
    process.stdout.write(part);
  }
  process.stdout.write('\n\n');

  const result = finalize(question, text, hits);
  if (result.refused) return;
  if (result.citations.length) {
    console.log(pc.bold('Sources'));
    for (const { number, hit } of result.citations) {
      const section = hit.section ? ` · ${hit.section}` : '';
      console.log(`  ${pc.cyan(`[${number}]`)} ${hit.filename}, ${pages(hit)}${section}`);
      console.log(pc.dim(`      “${snippet(hit.text)}”`));
    }
  }
  if (result.uncited) console.log(pc.yellow('Warning: the answer has no citations; it may not be grounded in your documents.'));
  if (result.invalidCitations.length) {
    console.log(pc.yellow(`Warning: cited non-existent sources ${result.invalidCitations.join(', ')}.`));
  }
}

const program = new Command()
  .name('documind')
  .description('Ask questions about your PDFs and get answers with page citations.');

program
  .command('setup')
  .description('Create the Atlas search indexes (vector + keyword)')
  .action(
    withDB(async () => {
      const created = await ensureSearchIndexes();
      if (created.length) {
        console.log(pc.green(`Created: ${created.join(', ')}.`));
        console.log('New indexes take about a minute to become queryable; check with: npm run cli -- status');
      } else {
        console.log('All search indexes already exist.');
      }
    }),
  );

program
  .command('status')
  .description('Show search index status and document count')
  .action(
    withDB(async () => {
      const { vector, text } = await searchIndexStatus();
      const show = (i) => (i ? `${i.status}${i.queryable ? ' (queryable)' : ''}` : pc.yellow('missing. Run: npm run cli -- setup'));
      console.log(`Vector index:  ${show(vector)}`);
      console.log(`Keyword index: ${show(text)}`);
      console.log(`Search mode:   ${config.searchMode}`);
      console.log(`Documents:     ${await Document.countDocuments({ status: 'ready' })}`);
    }),
  );

program
  .command('ingest')
  .description('Index PDF files or folders')
  .argument('<paths...>', 'PDF files or folders')
  .option('-f, --force', 're-index even if unchanged')
  .action(
    withDB(async (paths, opts) => {
      const pdfs = await collectPdfs(paths);
      if (!pdfs.length) throw new Error('No PDFs found.');
      for (const file of pdfs) {
        const name = path.basename(file);
        try {
          const started = Date.now();
          const { document: d, skipped } = await indexPdf(await fs.readFile(file), name, {
            force: opts.force,
            onProgress: (step) => process.stdout.write(pc.dim(`  ${name}: ${step}…\r`)),
          });
          process.stdout.write(' '.repeat(80) + '\r');
          if (skipped) console.log(pc.dim(`• ${name} already indexed (${d.numChunks} chunks). Use --force to redo.`));
          else {
            const secs = ((Date.now() - started) / 1000).toFixed(1);
            console.log(`${pc.green('✓')} ${name}: ${d.numPages} pages → ${d.numChunks} chunks in ${secs}s ${pc.dim(`id=${d._id}`)}`);
          }
        } catch (err) {
          console.log(pc.red(`✗ ${name}: ${err.message}`));
        }
      }
    }),
  );

program
  .command('docs')
  .description('List indexed documents')
  .action(
    withDB(async () => {
      const docs = await Document.find().sort({ createdAt: 1 }).lean();
      if (!docs.length) return console.log('No documents yet. Try: npm run cli -- ingest path/to/file.pdf');
      for (const d of docs) {
        const status = d.status === 'ready' ? '' : pc.yellow(` [${d.status}]`);
        console.log(`${pc.dim(String(d._id))}  ${d.filename}  ${pc.dim(`${d.numPages}p, ${d.numChunks} chunks`)}${status}`);
        console.log(`  ${snippet(d.title, 90)}`);
      }
    }),
  );

program
  .command('remove')
  .description('Remove a document from the index')
  .argument('<id>', 'document id (see `docs`)')
  .action(
    withDB(async (id) => {
      if (await deleteDocument(id)) console.log(`Removed ${id}`);
      else throw new Error(`No document with id ${id}`);
    }),
  );

program
  .command('search')
  .description('Show what retrieval finds (no LLM call, no API key needed)')
  .argument('<query>')
  .option('-k, --top-k <n>', 'number of passages', toInt)
  .option('-d, --doc <ids...>', 'limit to document id(s)')
  .option('-m, --mode <mode>', 'hybrid | vector | keyword (default from .env)')
  .option('--no-rerank', 'skip the cross-encoder reranker')
  .action(
    withDB(async (query, opts) => {
      const hits = await retrieve(query, { topK: opts.topK, documentIds: opts.doc, mode: opts.mode, rerank: opts.rerank });
      if (!hits.length) return console.log('No results. Is anything indexed, and is the index queryable (npm run cli -- status)?');
      hits.forEach((h, i) => {
        const section = h.section ? ` · ${h.section}` : '';
        console.log(`${pc.cyan(`[${i + 1}]`)} ${scoreLabel(h)}  ${h.filename} ${pages(h)}${section}`);
        console.log(pc.dim(`    ${snippet(h.text, 300)}\n`));
      });
    }),
  );

program
  .command('ask')
  .description('Answer a question with citations')
  .argument('<question>')
  .option('-p, --provider <name>', 'claude | groq | ollama (default from .env)')
  .option('-k, --top-k <n>', 'number of passages', toInt)
  .option('-d, --doc <ids...>', 'limit to document id(s)')
  .option('--show-context', 'print retrieved passages and scores')
  .option('-c, --compare', 'compare the --doc documents side by side')
  .action(
    withDB(async (question, opts) => {
      const llm = getLLM(opts.provider);
      await answer(question, llm, { topK: opts.topK, documentIds: opts.doc, showContext: opts.showContext, compare: opts.compare });
    }),
  );

program
  .command('chat')
  .description('Interactive Q&A. Empty line to quit.')
  .option('-p, --provider <name>', 'claude | groq | ollama')
  .option('-d, --doc <ids...>', 'limit to document id(s)')
  .action(
    withDB(async (opts) => {
      const llm = getLLM(opts.provider);
      console.log(pc.dim(`Using ${llm.name}. Empty line to quit.`));
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      try {
        for (;;) {
          const question = (await rl.question(pc.green('\n? '))).trim();
          if (!question) break;
          try {
            await answer(question, llm, { documentIds: opts.doc });
          } catch (err) {
            if (!(err instanceof LLMError)) throw err;
            console.log(pc.red(err.message));
          }
        }
      } finally {
        rl.close();
      }
    }),
  );

await program.parseAsync();
