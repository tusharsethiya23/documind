import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUserPrompt } from '../src/services/prompts.js';
import { finalize, isAnswerable, parseCitations, REFUSAL } from '../src/services/qa.js';

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

test('marks answers without citations as uncited', () => {
  const result = finalize('q', 'Paris is the capital of France.', hits);
  assert.equal(result.refused, false);
  assert.equal(result.uncited, true);
});

test('retrieval gate refuses when the best score is too low', () => {
  assert.equal(isAnswerable([], 0.78), false);
  assert.equal(isAnswerable([hit(1, 0.6)], 0.78), false);
  assert.equal(isAnswerable([hit(1, 0.85)], 0.78), true);
});

test('prompt numbers sources and includes pages and sections', () => {
  const prompt = buildUserPrompt('What?', hits.slice(0, 2));
  assert.match(prompt, /<source id="1" document="paper.pdf" section="Intro" pages="1">\nPassage 1\n<\/source>/);
  assert.match(prompt, /<source id="2" document="paper.pdf" pages="2">/);
  assert.ok(prompt.endsWith('Question: What?'));
});
