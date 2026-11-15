/** Question answering: retrieve -> (refuse early | generate) -> attach citations. */
import { config } from '../config.js';
import { buildUserPrompt, REFUSAL, SYSTEM_PROMPT } from './prompts.js';
import { searchChunks } from './vectorSearch.js';

export { REFUSAL };

const CITATION = /\[(\d+(?:\s*[,;]\s*\d+)*)\]/g;

export const retrieve = (question, options = {}) => searchChunks(question, options);

/** Retrieval gate: skip the LLM entirely when nothing relevant was found. */
export const isAnswerable = (hits, minScore = config.minScore) => hits.length > 0 && hits[0].score >= minScore;

export async function* generate(question, hits, llm) {
  yield* llm.stream({ system: SYSTEM_PROMPT, user: buildUserPrompt(question, hits) });
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
  if (text.toLowerCase().includes(refusalCore) && text.length < REFUSAL.length + 40) {
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
