import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { config } from '../src/config.js';
import { rerank } from '../src/services/reranker.js';

// Uses the real model; skipped until it has been downloaded once (any search with RERANK=true does that).
const cached = fs.existsSync(path.join(config.modelCacheDir, ...config.rerankModel.split('/')));

test('reranker puts the passage that answers the question first', { skip: !cached && 'reranker model not downloaded yet' }, async () => {
  const hits = [
    { chunkId: 'rivers', text: 'Brightwater is a common name for rivers in England.' },
    { chunkId: 'accuracy', text: 'We measured a retrieval accuracy of 87.5 percent.' },
    { chunkId: 'answer', section: '1 Introduction', text: 'The capital of Veloria is Brightwater, founded in 1742.' },
  ];
  const ranked = await rerank('When was Brightwater founded?', hits, 2, { minScore: -100 });
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].chunkId, 'answer');
  assert.ok(ranked[0].rerankScore > ranked[1].rerankScore);
  assert.ok(!ranked.some((h) => h.chunkId === 'accuracy'), 'irrelevant passage should be cut');
});

test('passages below the minimum score are dropped, but the best is always kept', { skip: !cached && 'reranker model not downloaded yet' }, async () => {
  const hits = [
    { chunkId: 'accuracy', text: 'We measured a retrieval accuracy of 87.5 percent.' },
    { chunkId: 'answer', text: 'The capital of Veloria is Brightwater, founded in 1742.' },
  ];
  const kept = await rerank('When was Brightwater founded?', hits, 5, { minScore: -5 });
  assert.deepEqual(kept.map((h) => h.chunkId), ['answer']);

  const off = await rerank('How do I bake bread?', hits, 5, { minScore: 100 });
  assert.equal(off.length, 1, 'always keeps the top passage');
});

test('reranking one or zero hits is a no-op', async () => {
  assert.deepEqual(await rerank('q', [], 3), []);
  assert.deepEqual(await rerank('q', [{ chunkId: 'a' }], 3), [{ chunkId: 'a' }]);
});
