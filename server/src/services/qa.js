/** Question answering: retrieve -> (refuse early | generate) -> attach citations. */
import { config } from '../config.js';
import { buildUserPrompt, REFUSAL, SYSTEM_PROMPT } from './prompts.js';
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

export async function* generate(question, hits, llm, { signal } = {}) {
  yield* llm.stream({ system: SYSTEM_PROMPT, user: buildUserPrompt(question, hits), signal });
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
