/**
 * Download the local embedding and reranking models into .cache/models.
 * Docker runs this at build time so the container starts ready and works offline.
 */
import { config } from '../src/config.js';
import { embedQuery } from '../src/services/embeddings.js';
import { scorePassages } from '../src/services/reranker.js';

const started = Date.now();
console.log(`Embedding model: ${config.embedModel}`);
await embedQuery('warm up');
console.log(`Reranking model: ${config.rerankModel}`);
await scorePassages('warm up', ['a passage']);
console.log(`Models ready in ${((Date.now() - started) / 1000).toFixed(1)}s (${config.modelCacheDir})`);
