/**
 * Local embeddings with transformers.js (ONNX in Node; no API key, no Python).
 * The model downloads once (~130 MB) into server/.cache/models.
 */
import { env, pipeline } from '@huggingface/transformers';
import { config } from '../config.js';
import { ortSessionOptions } from './ortOptions.js';

env.cacheDir = config.modelCacheDir;

let extractorPromise;
const getExtractor = () => {
  extractorPromise ??= pipeline('feature-extraction', config.embedModel, {
    dtype: 'fp32',
    session_options: ortSessionOptions(),
  });
  return extractorPromise;
};

const BATCH = 16;

async function embed(texts) {
  const extractor = await getExtractor();
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    // BGE models use the [CLS] token embedding, normalised for cosine similarity.
    const tensor = await extractor(texts.slice(i, i + BATCH), { pooling: 'cls', normalize: true });
    out.push(...tensor.tolist());
  }
  return out;
}

export const embedPassages = (texts) => embed(texts);

export async function embedQuery(text) {
  const [vector] = await embed([config.queryPrefix + text]);
  return vector;
}
