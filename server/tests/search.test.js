import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestScore, isAnswerable } from '../src/services/qa.js';
import { fuseRankings } from '../src/services/search.js';

const v = (id, score) => ({ _id: id, score });
const k = (id, keywordScore) => ({ _id: id, keywordScore });

test('chunks found by both searches rank first', () => {
  const fused = fuseRankings([v('a', 0.9), v('b', 0.8), v('c', 0.7)], [k('c', 12), k('d', 9)]);
  assert.equal(fused[0]._id, 'c');
  assert.deepEqual(fused[0].matchedBy, ['vector', 'keyword']);
  assert.equal(fused[0].score, 0.7); // keeps the vector similarity
  assert.equal(fused[0].keywordScore, 12);
});

test('keyword-only hits are included with a null vector score', () => {
  const fused = fuseRankings([v('a', 0.9)], [k('z', 5)]);
  const z = fused.find((h) => h._id === 'z');
  assert.equal(z.score, null);
  assert.deepEqual(z.matchedBy, ['keyword']);
});

test('equal ranks in different lists tie; limit trims the result', () => {
  const fused = fuseRankings([v('a', 0.9), v('b', 0.8)], [k('x', 9), k('y', 8)], { limit: 2 });
  assert.equal(fused.length, 2);
  assert.equal(fused[0].rrf, fused[1].rrf);
  assert.deepEqual(fused.map((h) => h._id).sort(), ['a', 'x']);
});

test('RRF score is the sum of 1/(k + rank)', () => {
  const [top] = fuseRankings([v('a', 0.9)], [k('a', 3)], { k: 60 });
  assert.ok(Math.abs(top.rrf - 2 / 61) < 1e-12);
});

test('the relevance gate uses the best vector score, ignoring keyword-only hits', () => {
  const hits = [{ score: null }, { score: 0.74 }, { score: 0.6 }];
  assert.equal(bestScore(hits), 0.74);
  assert.equal(isAnswerable(hits, { minScore: 0.72 }), true);
  assert.equal(isAnswerable([{ score: null }], { minScore: 0.72 }), false);
});
