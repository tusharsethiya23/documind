import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildComparePrompt, buildUserPrompt, stripReferenceMarkers } from '../src/services/prompts.js';
import { finalize, isAnswerable, normalizeCitations, parseCitations, REFUSAL } from '../src/services/qa.js';

const hit = (n, score = 0.9) => ({
  chunkId: `c${n}`,
  score,
  text: `Passage ${n}`,
  section: n === 1 ? 'Intro' : '',
  pageStart: n,
  pageEnd: n,
  filename: 'paper.pdf',
});
const hits = [hit(1), hit(2), hit(3)];

test('parses single, adjacent and grouped citations', () => {
  const { citations, invalid } = parseCitations('A is true [2]. B too [1][3]. C [1, 3].', hits);
  assert.deepEqual(citations.map((c) => c.number), [1, 2, 3]);
  assert.equal(citations[1].hit.chunkId, 'c2');
  assert.deepEqual(invalid, []);
});

test('normalises full-width citation brackets', () => {
  assert.equal(normalizeCitations('ϵ = 0.1【1】 and 28.4【2】【3】.'), 'ϵ = 0.1[1] and 28.4[2][3].');
  const { citations } = parseCitations(normalizeCitations('Value【2】.'), hits);
  assert.deepEqual(citations.map((c) => c.number), [2]);
});

test('flags citations that point at non-existent sources', () => {
  const { citations, invalid } = parseCitations('Claim [2]. Made up [7].', hits);
  assert.deepEqual(citations.map((c) => c.number), [2]);
  assert.deepEqual(invalid, [7]);
});

test('ignores bracketed text that is not a citation', () => {
  const { citations } = parseCitations('See the array [a, b] and note [x].', hits);
  assert.equal(citations.length, 0);
});

test('recognises the refusal phrase', () => {
  const result = finalize('q', `  ${REFUSAL}\n`, hits);
  assert.equal(result.refused, true);
  assert.equal(result.text, REFUSAL);
});

test('recognises a refusal followed by an explanation', () => {
  const result = finalize('q', `${REFUSAL} The sources do not mention GPT-4.`, hits);
  assert.equal(result.refused, true);
});

test('does not treat an answer that merely mentions the phrase late as a refusal', () => {
  const long = `The paper reports 28.4 BLEU [1]. For the other metric, ${REFUSAL.toLowerCase()} Beyond that, see [2].`;
  assert.equal(finalize('q', long, hits).refused, false);
});

test('rerank gate refuses when even the best passage scores too low', () => {
  const reranked = (score, rerankScore) => ({ score, rerankScore });
  assert.equal(isAnswerable([reranked(0.8, -4.2), reranked(0.79, -9)], { minScore: 0.72, rerankGate: -4 }), false);
  assert.equal(isAnswerable([reranked(0.8, -2.7)], { minScore: 0.72, rerankGate: -4 }), true);
  // No rerank scores (reranking off): only the vector gate applies.
  assert.equal(isAnswerable([{ score: 0.8 }], { minScore: 0.72, rerankGate: -4 }), true);
});

test('marks answers without citations as uncited', () => {
  const result = finalize('q', 'Paris is the capital of France.', hits);
  assert.equal(result.refused, false);
  assert.equal(result.uncited, true);
});

test('retrieval gate refuses when the best score is too low', () => {
  assert.equal(isAnswerable([], { minScore: 0.78 }), false);
  assert.equal(isAnswerable([hit(1, 0.6)], { minScore: 0.78 }), false);
  assert.equal(isAnswerable([hit(1, 0.85)], { minScore: 0.78 }), true);
});

test("strips the document's own reference markers from source text", () => {
  assert.equal(stripReferenceMarkers('We use FAISS [23] with HNSW [37, 38].'), 'We use FAISS with HNSW.');
  assert.equal(stripReferenceMarkers('Prior work [4–6] and [12; 14] showed this.'), 'Prior work and showed this.');
  assert.equal(stripReferenceMarkers('Keep array[i] and [a] intact.'), 'Keep array[i] and [a] intact.');
  const prompt = buildUserPrompt('q', [{ ...hit(1), text: 'Label smoothing [36] of 0.1.' }]);
  assert.ok(prompt.includes('Label smoothing of 0.1.'));
});

test('comparison prompt groups sources by document with continuous numbering', () => {
  const prompt = buildComparePrompt('Which GPUs?', [
    { filename: 'a.pdf', covered: true, hits: [hit(1), hit(2)] },
    { filename: 'b.pdf', covered: false, hits: [] },
    { filename: 'c.pdf', covered: true, hits: [hit(3)] },
  ]);
  assert.match(prompt, /<document name="a.pdf">\n<source id="1"[\s\S]*<source id="2"/);
  assert.match(prompt, /<document name="b.pdf" covers_question="no">/);
  assert.match(prompt, /<document name="c.pdf">\n<source id="3"/);
  assert.ok(prompt.includes('Compare how these documents address the question: a.pdf, b.pdf, c.pdf.'));
});

test('prompt numbers sources and includes pages and sections', () => {
  const prompt = buildUserPrompt('What?', hits.slice(0, 2));
  assert.match(prompt, /<source id="1" document="paper.pdf" section="Intro" pages="1">\nPassage 1\n<\/source>/);
  assert.match(prompt, /<source id="2" document="paper.pdf" pages="2">/);
  assert.ok(prompt.includes('Question: What?\n\nAnswer using only the sources above.'));
});
