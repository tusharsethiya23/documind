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
  // Public demo settings
  readOnly: env('READ_ONLY', 'false') === 'true', // disable upload/delete
  askLimitPer10Min: Number(env('ASK_LIMIT_PER_10_MIN', '0')), // questions per IP per 10 min; 0 = no limit
  trustProxy: Number(env('TRUST_PROXY', '0')), // number of proxies in front (1 on most hosts)
  clientDist: env('CLIENT_DIST', ''), // folder with the built React app to serve (production)

  mongoUri: env('MONGODB_URI', ''),
  dbName: env('MONGODB_DB', 'documind'),

  llmProvider: env('LLM_PROVIDER', 'claude'), // "claude" | "ollama"
  claudeModel: env('CLAUDE_MODEL', 'claude-opus-5-5'),
  claudeEffort: env('CLAUDE_EFFORT', 'medium'), // low | medium | high | xhigh | max
  ollamaModel: env('OLLAMA_MODEL', 'llama3.2'),
  ollamaHost: env('OLLAMA_HOST', 'http://localhost:11434'),
  groqApiKey: env('GROQ_API_KEY', ''),
  groqModel: env('GROQ_MODEL', 'openai/gpt-oss-120b'),
  // For reasoning models (gpt-oss): low keeps answers fast and within free-tier token limits.
  groqReasoningEffort: env('GROQ_REASONING_EFFORT', 'low'),
  groqBaseUrl: env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),

  // Local embedding model (runs in Node via transformers.js, no API key).
  embedModel: env('EMBED_MODEL', 'Xenova/bge-small-en-v1.5'),
  embedDimensions: Number(env('EMBED_DIMENSIONS', '384')),
  queryPrefix: env('EMBED_QUERY_PREFIX', 'Represent this sentence for searching relevant passages: '),

  topK: Number(env('TOP_K', '6')),
  searchMode: env('SEARCH_MODE', 'hybrid'), // hybrid | vector | keyword
  comparePerDoc: Number(env('COMPARE_PER_DOC', '3')), // passages per document when comparing
  rerank: env('RERANK', 'true') === 'true',
  rerankModel: env('RERANK_MODEL', 'Xenova/ms-marco-MiniLM-L-6-v2'),
  rerankCandidates: Number(env('RERANK_CANDIDATES', '20')), // how many search results the reranker sees
  // Drop passages the reranker scores below this (clearly irrelevant ones score around -10).
  rerankMinScore: Number(env('RERANK_MIN_SCORE', '-5')),
  rerankBatch: Number(env('RERANK_BATCH', '2')), // passages per reranker call; lower = less memory

  // onnxruntime (local models). Small hosts report many cores but allow a fraction
  // of one: 1 thread avoids thrashing. Low-memory mode frees buffers between calls.
  ortThreads: Number(env('ORT_THREADS', '0')), // 0 = onnxruntime default (one per core)
  ortLowMemory: env('ORT_LOW_MEMORY', 'false') === 'true',
  // Say "I don't know" if even the best passage scores below this (see eval/RESULTS.md).
  rerankGate: Number(env('RERANK_GATE', '-4')),
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
