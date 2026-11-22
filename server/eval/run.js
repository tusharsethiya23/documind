#!/usr/bin/env node
/**
 * DocuMind evaluation.
 *
 *   npm run eval                     retrieval + answer evaluation
 *   npm run eval -- --retrieval-only  skip the LLM (fast)
 *   npm run eval -- --provider groq --final-only
 *                                    answers with another LLM, final setup only
 *                                    (results for other LLMs are kept in the report)
 *   npm run eval -- --rescore         re-grade saved answers after changing the grader
 *
 * Retrieval (no LLM), per search setup:
 *   Hit@1 / Hit@3 / Recall@6  the evidence passage is in the top 1 / 3 / 6
 *   MRR                       mean of 1/rank of the first relevant passage
 * Answers (LLM), baseline vs final pipeline:
 *   Correct          answer contains the expected facts
 *   Citation prec.   share of cited passages that contain the evidence
 *   Refusal          unanswerable questions answered "I don't know"
 *   False refusal    answerable questions wrongly refused
 *
 * Results are written to eval/results.json and eval/RESULTS.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { config } from '../src/config.js';
import { connectDB, disconnectDB } from '../src/db.js';
import { Document } from '../src/models/Document.js';
import { getLLM, LLMError } from '../src/services/llm.js';
import { finalize, generate, isAnswerable, retrieve } from '../src/services/qa.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const args = new Set(argv);
const providerArg = argv.includes('--provider') ? argv[argv.indexOf('--provider') + 1] : undefined;
const TOP_K = config.topK;

const RETRIEVAL_SETUPS = [
  { name: 'Vector only', mode: 'vector', rerank: false },
  { name: 'Keyword only (BM25)', mode: 'keyword', rerank: false },
  { name: 'Hybrid (RRF)', mode: 'hybrid', rerank: false },
  { name: 'Hybrid + rerank', mode: 'hybrid', rerank: true },
];
const ANSWER_SETUPS = [
  { name: 'Baseline: vector only', mode: 'vector', rerank: false },
  { name: 'Final: hybrid + rerank', mode: 'hybrid', rerank: true },
];

// ---------- scoring helpers ----------

// Also unify hyphen/dash variants: models sometimes write "100‑word" with U+2011.
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A retrieved hit is relevant if it comes from the right document and contains an evidence phrase. */
export function isRelevant(hit, q) {
  if (hit.filename !== q.doc) return false;
  const haystack = norm(`${hit.section ?? ''} ${hit.text}`);
  return [q.evidence].flat().some((e) => haystack.includes(norm(e)));
}

/**
 * A cited passage supports the answer if it is the evidence passage, or if it
 * contains every expected fact itself (e.g. a results table holding "44.5").
 */
const supports = (hit, q) => isRelevant(hit, q) || (hit.filename === q.doc && answerMatches(hit.text, q.answer));

/** Every group must be matched by one of its phrasings (whole-word match for numbers). */
export function answerMatches(text, groups) {
  const clean = norm(text.replace(/\[\d+(?:\s*[,;]\s*\d+)*\]/g, ' '));
  return groups.every((alts) =>
    alts.some((alt) => {
      const a = norm(alt);
      return /^[\d.,]+$/.test(a) ? new RegExp(`(^|[^\\d.])${escapeRe(a)}(?![\\d])`).test(clean) : clean.includes(a);
    }),
  );
}

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(0)}%` : '–');
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ---------- evaluation ----------

async function evalRetrieval(questions, setup) {
  const answerable = questions.filter((q) => q.answerable !== false);
  const unanswerable = questions.filter((q) => q.answerable === false);
  const ranks = [];
  let gateKept = 0;
  let gateRejected = 0;
  const started = Date.now();
  for (const q of answerable) {
    const hits = await retrieve(q.question, { topK: TOP_K, mode: setup.mode, rerank: setup.rerank });
    const idx = hits.findIndex((h) => isRelevant(h, q));
    ranks.push(idx === -1 ? null : idx + 1);
    if (setup.mode !== 'keyword' && isAnswerable(hits)) gateKept++;
  }
  for (const q of unanswerable) {
    const hits = await retrieve(q.question, { topK: TOP_K, mode: setup.mode, rerank: setup.rerank });
    if (setup.mode !== 'keyword' && !isAnswerable(hits)) gateRejected++;
  }
  const n = answerable.length;
  return {
    setup: setup.name,
    hit1: ranks.filter((r) => r === 1).length / n,
    hit3: ranks.filter((r) => r && r <= 3).length / n,
    recall: ranks.filter((r) => r).length / n,
    mrr: mean(ranks.map((r) => (r ? 1 / r : 0))),
    gate: setup.mode === 'keyword' ? null : { answerableKept: gateKept / n, unanswerableRejected: gateRejected / unanswerable.length },
    msPerQuery: Math.round((Date.now() - started) / questions.length),
    misses: answerable.filter((_, i) => !ranks[i]).map((q) => q.id),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Free-tier APIs rate-limit per minute: wait and retry instead of failing the run. */
async function generateWithRetry(question, hits, llm, attempts = 6) {
  for (let attempt = 1; ; attempt++) {
    try {
      let text = '';
      for await (const part of generate(question, hits, llm)) text += part;
      return text;
    } catch (err) {
      const limited = err instanceof LLMError && /limit/i.test(err.message);
      if (!limited || attempt >= attempts) throw err;
      const wait = Number(err.message.match(/try again in ([\d.]+)s/)?.[1] ?? 20) + 1;
      process.stdout.write(pc.dim(`  rate limited, waiting ${wait}s…\x1b[K\r`));
      await sleep(wait * 1000);
    }
  }
}

async function evalAnswers(questions, setup, llm) {
  const rows = [];
  for (const [i, q] of questions.entries()) {
    process.stdout.write(pc.dim(`  ${setup.name}: ${i + 1}/${questions.length} ${q.id}\x1b[K\r`));
    const started = Date.now();
    const hits = await retrieve(q.question, { topK: TOP_K, mode: setup.mode, rerank: setup.rerank });
    let result;
    if (!isAnswerable(hits)) {
      result = { refused: true, text: '', citations: [] };
    } else {
      const text = await generateWithRetry(q.question, hits, llm);
      result = finalize(q.question, text, hits);
    }
    const cited = result.citations.map((c) => c.hit);
    rows.push({
      id: q.id,
      answerable: q.answerable !== false,
      refused: result.refused,
      correct: q.answerable !== false && !result.refused && answerMatches(result.text, q.answer),
      cited: cited.length,
      citedRelevant: q.answerable === false ? 0 : cited.filter((h) => supports(h, q)).length,
      text: result.text,
      ms: Date.now() - started,
    });
  }
  process.stdout.write('\x1b[K');

  const ans = rows.filter((r) => r.answerable);
  const unans = rows.filter((r) => !r.answerable);
  const citedTotal = ans.reduce((n, r) => n + r.cited, 0);
  return {
    setup: setup.name,
    llm: llm.name,
    correct: ans.filter((r) => r.correct).length / ans.length,
    citationPrecision: citedTotal ? ans.reduce((n, r) => n + r.citedRelevant, 0) / citedTotal : 0,
    grounded: ans.filter((r) => r.correct && r.citedRelevant > 0).length / ans.length,
    refusal: unans.filter((r) => r.refused).length / unans.length,
    falseRefusal: ans.filter((r) => r.refused).length / ans.length,
    secPerQuestion: mean(rows.map((r) => r.ms)) / 1000,
    rows,
  };
}

// ---------- report ----------

function markdown({ retrieval, answers, meta }) {
  const lines = [
    '# Evaluation results',
    '',
    `Run ${meta.date} on ${meta.documents.join(', ')}: ${meta.answerable} answerable questions and ${meta.unanswerable} that the papers don't cover. Top-k = ${meta.topK}. Generated by \`npm run eval\`.`,
    '',
    '## Retrieval',
    '',
    'Does the passage containing the answer come back, and how high is it ranked?',
    '',
    '| Setup | Hit@1 | Hit@3 | Recall@6 | MRR | Answerable kept by gate | Unanswerable rejected by gate |',
    '|---|---|---|---|---|---|---|',
    ...retrieval.map(
      (r) =>
        `| ${r.setup} | ${pct(r.hit1, 1)} | ${pct(r.hit3, 1)} | ${pct(r.recall, 1)} | ${r.mrr.toFixed(2)} | ${r.gate ? pct(r.gate.answerableKept, 1) : 'n/a'} | ${r.gate ? pct(r.gate.unanswerableRejected, 1) : 'n/a'} |`,
    ),
  ];
  if (answers?.length) {
    lines.push(
      '',
      '## Answers',
      '',
      '| LLM | Setup | Correct | Correct + cited evidence | Citation precision | Refused unanswerable | Wrongly refused | Sec / question |',
      '|---|---|---|---|---|---|---|---|',
      ...answers.map(
        (a) =>
          `| ${a.llm ?? meta.llm} | ${a.setup} | ${pct(a.correct, 1)} | ${pct(a.grounded, 1)} | ${pct(a.citationPrecision, 1)} | ${pct(a.refusal, 1)} | ${pct(a.falseRefusal, 1)} | ${a.secPerQuestion.toFixed(1)} |`,
      ),
    );
  }
  lines.push(
    '',
    '## How it is measured',
    '',
    '- **Relevant passage**: a retrieved chunk from the right paper that contains a short evidence phrase copied from that paper.',
    '- **Hit@k**: share of questions whose relevant passage is in the top k. **MRR**: mean of 1/rank of the first relevant passage (0 if missing).',
    '- **Gate**: the relevance cutoff that answers "I don\'t know" without calling the LLM.',
    '- **Correct**: the answer contains every expected fact (e.g. "28.4"), ignoring citation markers.',
    '- **Correct + cited evidence**: correct, and at least one cited passage supports it (contains the evidence phrase, or every expected fact).',
    '- **Citation precision**: share of all cited passages that support the answer (same rule).',
    '',
    'Questions are in [`questions.json`](questions.json); per-question outputs are in `results.json`.',
    '',
    '## Caveats',
    '',
    `- Small set: ${meta.answerable + meta.unanswerable} questions over 2 papers, so one question moves a percentage by about 4 points. Treat differences under ~10 points as noise.`,
    '- Both answer setups use the same prompt; they differ only in retrieval (vector vs hybrid + rerank).',
    '- The rerank gate threshold (`RERANK_GATE=-4`) was picked by looking at this question set, so its refusal numbers may be optimistic on new documents.',
    '- One run per LLM at temperature 0. Hosted free-tier models may change behind the same name.',
  );
  return lines.join('\n') + '\n';
}

// ---------- main ----------

const set = JSON.parse(await fs.readFile(path.join(here, 'questions.json'), 'utf8'));

if (args.has('--rescore')) {
  // Re-grade saved answers with the current grader (no database or LLM calls).
  // Citation counts were computed at run time and are kept as they are.
  const saved = JSON.parse(await fs.readFile(path.join(here, 'results.json'), 'utf8'));
  const byId = new Map(set.questions.map((q) => [q.id, q]));
  for (const a of saved.answers) {
    for (const row of a.rows) {
      if (row.answerable) row.correct = !row.refused && answerMatches(row.text, byId.get(row.id).answer);
    }
    const ans = a.rows.filter((r) => r.answerable);
    a.correct = ans.filter((r) => r.correct).length / ans.length;
    a.grounded = ans.filter((r) => r.correct && r.citedRelevant > 0).length / ans.length;
    console.log(`  ${(a.llm ?? saved.meta.llm).padEnd(26)} ${a.setup.padEnd(24)} correct ${pct(a.correct, 1)}  grounded ${pct(a.grounded, 1)}`);
  }
  await fs.writeFile(path.join(here, 'results.json'), JSON.stringify(saved, null, 2));
  await fs.writeFile(path.join(here, 'RESULTS.md'), markdown(saved));
  console.log(pc.green('Re-scored eval/results.json and eval/RESULTS.md'));
  process.exit(0);
}

await connectDB();
try {
  const present = new Set((await Document.find({ status: 'ready' }).select('filename').lean()).map((d) => d.filename));
  const missing = set.documents.filter((d) => !present.has(d));
  if (missing.length) {
    throw new Error(`Index these first: ${missing.join(', ')} (download links are in eval/README.md).`);
  }

  console.log(pc.bold(`Retrieval: ${set.questions.length} questions × ${RETRIEVAL_SETUPS.length} setups`));
  const retrieval = [];
  for (const setup of RETRIEVAL_SETUPS) {
    const r = await evalRetrieval(set.questions, setup);
    retrieval.push(r);
    console.log(`  ${setup.name.padEnd(22)} Hit@1 ${pct(r.hit1, 1).padStart(4)}  Hit@3 ${pct(r.hit3, 1).padStart(4)}  Recall@${TOP_K} ${pct(r.recall, 1).padStart(4)}  MRR ${r.mrr.toFixed(2)}${r.misses.length ? pc.dim(`  missed: ${r.misses.join(', ')}`) : ''}`);
  }

  let answers = [];
  let llmName = null;
  if (!args.has('--retrieval-only')) {
    const llm = getLLM(providerArg);
    llmName = llm.name;
    const setups = args.has('--final-only') ? ANSWER_SETUPS.slice(-1) : ANSWER_SETUPS;
    console.log(pc.bold(`\nAnswers with ${llm.name}: ${set.questions.length} questions × ${setups.length} setup(s)`));
    for (const setup of setups) {
      const a = await evalAnswers(set.questions, setup, llm);
      answers.push(a);
      console.log(`  ${setup.name.padEnd(24)} correct ${pct(a.correct, 1).padStart(4)}  grounded ${pct(a.grounded, 1).padStart(4)}  cite-precision ${pct(a.citationPrecision, 1).padStart(4)}  refused-unanswerable ${pct(a.refusal, 1)}  wrongly-refused ${pct(a.falseRefusal, 1)}`);
    }
  }

  const meta = {
    date: new Date().toISOString().slice(0, 10),
    documents: set.documents,
    answerable: set.questions.filter((q) => q.answerable !== false).length,
    unanswerable: set.questions.filter((q) => q.answerable === false).length,
    topK: TOP_K,
    llm: llmName,
    embedModel: config.embedModel,
    rerankModel: config.rerankModel,
  };
  // Keep earlier results from other LLMs/setups so the report can compare them.
  const previous = await fs.readFile(path.join(here, 'results.json'), 'utf8').then(JSON.parse).catch(() => null);
  const kept = (previous?.answers ?? [])
    .map((a) => ({ ...a, llm: a.llm ?? previous.meta?.llm }))
    .filter((a) => !answers.some((n) => n.llm === a.llm && n.setup === a.setup));
  answers = [...kept, ...answers];
  await fs.writeFile(path.join(here, 'results.json'), JSON.stringify({ meta, retrieval, answers }, null, 2));
  if (answers.length || !args.has('--retrieval-only')) {
    await fs.writeFile(path.join(here, 'RESULTS.md'), markdown({ retrieval, answers, meta }));
    console.log(pc.green('\nWrote eval/RESULTS.md and eval/results.json'));
  } else {
    console.log(pc.green('\nWrote eval/results.json (run without --retrieval-only to refresh RESULTS.md)'));
  }
} finally {
  await disconnectDB();
}
