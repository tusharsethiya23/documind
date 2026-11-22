/**
 * Cross-encoder reranking (local, via transformers.js).
 *
 * Search compares the question and each passage separately (as vectors or
 * keywords). A cross-encoder reads the question and passage together and
 * scores how well the passage answers it: slower, but more precise. So we
 * search wide (e.g. 20 candidates) and let the reranker pick the best few.
 */
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';
import { config } from '../config.js';

env.cacheDir = config.modelCacheDir;

let loading;
const load = () => {
  loading ??= Promise.all([
    AutoTokenizer.from_pretrained(config.rerankModel),
    AutoModelForSequenceClassification.from_pretrained(config.rerankModel, { dtype: 'q8' }),
  ]).catch((err) => {
    loading = undefined; // allow a retry later
    throw err;
  });
  return loading;
};

// Passages scored per model call. Smaller batches use far less peak memory
// (activations scale with batch x length) at the same results; 2 keeps the
// server inside a 512 MB free-tier container.
const BATCH = config.rerankBatch;

/** Relevance score per passage (higher = better; raw logits, roughly -12..12). */
export async function scorePassages(question, passages) {
  const [tokenizer, model] = await load();
  const scores = [];
  for (let i = 0; i < passages.length; i += BATCH) {
    const batch = passages.slice(i, i + BATCH);
    const inputs = tokenizer(new Array(batch.length).fill(question), {
      text_pair: batch,
      padding: true,
      truncation: true,
      max_length: 512,
    });
    const { logits } = await model(inputs);
    scores.push(...Array.from(logits.data));
  }
  return scores;
}

/**
 * Reorder hits by cross-encoder score and keep the best `topK`. Adds `rerankScore`.
 * Passages scoring below `minScore` are dropped (the best one is always kept):
 * irrelevant passages in the prompt invite the LLM to cite them anyway.
 */
export async function rerank(question, hits, topK, { minScore = config.rerankMinScore } = {}) {
  if (hits.length <= 1) return hits.slice(0, topK);
  const scores = await scorePassages(
    question,
    hits.map((h) => (h.section ? `${h.section}\n${h.text}` : h.text)),
  );
  return hits
    .map((hit, i) => ({ ...hit, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .filter((hit, i) => i === 0 || hit.rerankScore >= minScore)
    .slice(0, topK);
}
