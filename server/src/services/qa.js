/** Question answering: retrieve -> (refuse early | generate) -> attach citations. */
import { config } from '../config.js';
import { Document } from '../models/Document.js';
import { buildComparePrompt, buildUserPrompt, COMPARE_SYSTEM_PROMPT, REFUSAL, SYSTEM_PROMPT } from './prompts.js';
import { rerank } from './reranker.js';
import { searchChunks } from './search.js';

export { REFUSAL };

const CITATION = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;

/**
 * Search, then (optionally) rerank.
 * @param {{topK?: number, documentIds?: string[], mode?: string, rerank?: boolean}} options
 */
export async function retrieve(question, { topK = config.topK, rerank: useRerank = config.rerank, ...options } = {}) {
  if (!useRerank) return searchChunks(question, { ...options, topK });
  const candidates = await searchChunks(question, { ...options, topK: Math.max(topK, config.rerankCandidates) });
  try {
    return await rerank(question, candidates, topK);
  } catch (err) {
    console.warn(`Reranking failed, using search order (${err.message})`);
    return candidates.slice(0, topK);
  }
}

/** Best vector similarity among the hits (keyword-only hits have score null). */
export const bestScore = (hits) => Math.max(-1, ...hits.map((h) => h.score ?? -1));

/**
 * Retrieval gate: skip the LLM entirely when nothing relevant was found.
 * 1. Vector similarity must clear `minScore` (comparable across questions; BM25 scores aren't).
 * 2. If the hits were reranked, the best cross-encoder score must clear `rerankGate`.
 *    The reranker judges "does this passage answer the question", which catches
 *    on-topic-but-unanswerable questions that vector similarity lets through.
 */
export function isAnswerable(hits, { minScore = config.minScore, rerankGate = config.rerankGate } = {}) {
  if (!hits.length || bestScore(hits) < minScore) return false;
  const reranked = hits.filter((h) => h.rerankScore != null);
  if (reranked.length && Math.max(...reranked.map((h) => h.rerankScore)) < rerankGate) return false;
  return true;
}

/**
 * Some models (e.g. gpt-oss) cite in their own style: "【1】", or with line
 * ranges like "【1†L1-L3】" / "[2†L5]". Normalise all of these to [1] so
 * citations are recognised everywhere.
 */
export const normalizeCitations = (text) =>
  text
    .replace(/【\s*(\d+)[^】]*】/g, '[$1]')
    .replace(/\[(\d+)†[^\]]*\]/g, '[$1]')
    .replace(/【/g, '[')
    .replace(/】/g, ']');

/**
 * Apply normalizeCitations to a token stream. A marker like "【1†L1-L3】" can be
 * split across chunks, so text from an unclosed "【" (or "[n†") is held back
 * until its closing bracket arrives (or 40 characters pass without one).
 */
async function* normalized(stream) {
  let pending = '';
  for await (const part of stream) {
    pending += part;
    const open = Math.max(pending.lastIndexOf('【'), pending.search(/\[\d+†[^\]]*$/));
    const closed = open !== -1 && /[】\]]/.test(pending.slice(open + 1));
    if (open !== -1 && !closed && pending.length - open < 40) {
      if (open > 0) yield normalizeCitations(pending.slice(0, open));
      pending = pending.slice(open);
      continue;
    }
    yield normalizeCitations(pending);
    pending = '';
  }
  if (pending) yield normalizeCitations(pending);
}

export const normalizeCitationStream = normalized;

export async function* generate(question, hits, llm, { signal } = {}) {
  yield* normalized(llm.stream({ system: SYSTEM_PROMPT, user: buildUserPrompt(question, hits), signal }));
}

/**
 * Comparison retrieval: search each document on its own, so a long or
 * keyword-dense document can't crowd the others out of the top-k.
 * @returns {Promise<{groups: {documentId, filename, hits, covered}[], hits: object[]}>}
 *   `hits` is the flat list (in group order) that [n] citations refer to.
 */
export async function retrieveForComparison(question, documentIds, { perDoc = config.comparePerDoc, ...options } = {}) {
  const docs = await Document.find({ _id: { $in: documentIds }, status: 'ready' }).select('filename').lean();
  const names = new Map(docs.map((d) => [String(d._id), d.filename]));
  const groups = await Promise.all(
    documentIds
      .filter((id) => names.has(String(id)))
      .map(async (id) => {
        const hits = await retrieve(question, { ...options, topK: perDoc, documentIds: [id] });
        const covered = isAnswerable(hits);
        return { documentId: String(id), filename: names.get(String(id)), hits: covered ? hits : [], covered };
      }),
  );
  return { groups, hits: groups.flatMap((g) => g.hits) };
}

export async function* generateComparison(question, groups, llm, { signal } = {}) {
  yield* normalized(llm.stream({ system: COMPARE_SYSTEM_PROMPT, user: buildComparePrompt(question, groups), signal }));
}

/** Extract [n] / [n, m] markers and map them to the retrieved passages. */
export function parseCitations(text, hits) {
  const numbers = [];
  for (const match of text.matchAll(CITATION)) {
    for (const n of match[1].split(/[,;]/).map((s) => Number(s.trim()))) {
      if (!numbers.includes(n)) numbers.push(n);
    }
  }
  const citations = numbers
    .filter((n) => n >= 1 && n <= hits.length)
    .sort((a, b) => a - b)
    .map((n) => ({ number: n, hit: hits[n - 1] }));
  const invalid = numbers.filter((n) => n < 1 || n > hits.length);
  return { citations, invalid };
}

export function finalize(question, rawText, hits) {
  const text = rawText.trim();
  const refusalCore = REFUSAL.toLowerCase().replace(/\.$/, '');
  const lower = text.toLowerCase();
  // Refusal = starts with the phrase ("I don't know... The sources don't mention X") or is just the phrase.
  if (lower.startsWith(refusalCore) || (lower.includes(refusalCore) && text.length < REFUSAL.length + 40)) {
    return { question, text: REFUSAL, hits, citations: [], refused: true, uncited: false, invalidCitations: [] };
  }
  const { citations, invalid } = parseCitations(text, hits);
  return {
    question,
    text,
    hits,
    citations,
    refused: false,
    uncited: citations.length === 0, // answered without citing anything: may be ungrounded
    invalidCitations: invalid,
  };
}

/** Non-streaming convenience wrapper (tests, and later the REST API). */
export async function ask(question, llm, options = {}) {
  const hits = await retrieve(question, options);
  if (!isAnswerable(hits)) {
    return { question, text: REFUSAL, hits, citations: [], refused: true, uncited: false, invalidCitations: [] };
  }
  let text = '';
  for await (const part of generate(question, hits, llm)) text += part;
  return finalize(question, text, hits);
}
