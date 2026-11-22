import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const env = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
};

export const config = {
  port: Number(env('PORT', '5000')),
  clientOrigin: env('CLIENT_ORIGIN', 'http://localhost:5173'), // the React dev server
  maxUploadMb: Number(env('MAX_UPLOAD_MB', '50')),

  mongoUri: env('MONGODB_URI', ''),
  dbName: env('MONGODB_DB', 'documind'),

  llmProvider: env('LLM_PROVIDER', 'claude'), // "claude" | "ollama"
  claudeModel: env('CLAUDE_MODEL', 'claude-opus-5-5'),
  claudeEffort: env('CLAUDE_EFFORT', 'medium'), // low | medium | high | xhigh | max
  ollamaModel: env('OLLAMA_MODEL', 'llama3.2'),
  ollamaHost: env('OLLAMA_HOST', 'http://localhost:11434'),

  // Local embedding model (runs in Node via transformers.js, no API key).
  embedModel: env('EMBED_MODEL', 'Xenova/bge-small-en-v1.5'),
  embedDimensions: Number(env('EMBED_DIMENSIONS', '384')),
  queryPrefix: env('EMBED_QUERY_PREFIX', 'Represent this sentence for searching relevant passages: '),

  topK: Number(env('TOP_K', '6')),
  searchMode: env('SEARCH_MODE', 'hybrid'), // hybrid | vector | keyword
  // Atlas reports cosine similarity rescaled to 0..1 as (1 + cos) / 2.
  // Below this score the best passage is treated as "not in the documents".
  minScore: Number(env('MIN_SCORE', '0.72')),

  chunkChars: 1200,
  chunkOverlapChars: 200,

  vectorIndexName: 'chunk_vector_index',
  textIndexName: 'chunk_text_index',
  uploadsDir: path.join(serverRoot, 'uploads'),
  modelCacheDir: path.join(serverRoot, '.cache', 'models'),
};
