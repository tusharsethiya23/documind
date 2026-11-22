/**
 * Retrieval over chunks in MongoDB Atlas.
 *
 *   vector  - Atlas Vector Search: matches meaning ("how accurate was it" ~ "87.5% exact match")
 *   keyword - Atlas Search (BM25): matches exact terms (names, codes, numbers, acronyms)
 *   hybrid  - both, merged with Reciprocal Rank Fusion (default)
 */
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Chunk } from '../models/Chunk.js';
import { Document } from '../models/Document.js';
import { embedQuery } from './embeddings.js';

const RRF_K = 60; // standard RRF constant; dampens the advantage of top ranks

export const indexDefinitions = () => [
  {
    name: config.vectorIndexName,
    type: 'vectorSearch',
    definition: {
      fields: [
        { type: 'vector', path: 'embedding', numDimensions: config.embedDimensions, similarity: 'cosine' },
        { type: 'filter', path: 'documentId' },
      ],
    },
  },
  {
    name: config.textIndexName,
    type: 'search',
    definition: {
      mappings: {
        dynamic: false,
        fields: {
          text: { type: 'string', analyzer: 'lucene.english' },
          section: { type: 'string', analyzer: 'lucene.english' },
          documentId: { type: 'objectId' },
        },
      },
    },
  },
];

/** Create any missing Atlas search indexes. Returns what was created. */
export async function ensureSearchIndexes() {
  await Chunk.createCollection().catch(() => {}); // already exists is fine
  const existing = new Set((await Chunk.collection.listSearchIndexes().toArray()).map((i) => i.name));
  const created = [];
  for (const def of indexDefinitions()) {
    if (existing.has(def.name)) continue;
    await Chunk.collection.createSearchIndex(def);
    created.push(def.name);
  }
  return created;
}

/** { [indexName]: {status, queryable} | null } */
export async function searchIndexStatus() {
  const indexes = await Chunk.collection.listSearchIndexes().toArray();
  const byName = new Map(indexes.map((i) => [i.name, { status: i.status, queryable: Boolean(i.queryable) }]));
  return {
    vector: byName.get(config.vectorIndexName) ?? null,
    text: byName.get(config.textIndexName) ?? null,
  };
}

const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(id));

const PROJECT = { _id: 1, documentId: 1, text: 1, section: 1, pageStart: 1, pageEnd: 1, regions: 1 };

async function vectorSearch(query, { limit, documentIds }) {
  const stage = {
    index: config.vectorIndexName,
    path: 'embedding',
    queryVector: await embedQuery(query),
    numCandidates: Math.max(100, limit * 20),
    limit,
  };
  if (documentIds?.length) stage.filter = { documentId: { $in: toObjectIds(documentIds) } };
  return Chunk.aggregate([{ $vectorSearch: stage }, { $project: { ...PROJECT, score: { $meta: 'vectorSearchScore' } } }]);
}

async function keywordSearch(query, { limit, documentIds }) {
  const compound = { must: [{ text: { query, path: ['text', 'section'] } }] };
  if (documentIds?.length) compound.filter = [{ in: { path: 'documentId', value: toObjectIds(documentIds) } }];
  return Chunk.aggregate([
    { $search: { index: config.textIndexName, compound } },
    { $limit: limit },
    { $project: { ...PROJECT, keywordScore: { $meta: 'searchScore' } } },
  ]);
}

/**
 * Reciprocal Rank Fusion: score = sum over lists of 1 / (k + rank).
 * Rewards chunks that rank well in either list, and most of all in both.
 * Keeps the vector similarity (`score`) for the relevance gate; keyword-only hits have score null.
 */
export function fuseRankings(vectorHits, keywordHits, { k = RRF_K, limit } = {}) {
  const merged = new Map();
  const add = (hits, source) =>
    hits.forEach((hit, rank) => {
      const id = String(hit._id);
      const entry = merged.get(id) ?? { ...hit, score: null, keywordScore: null, rrf: 0, matchedBy: [] };
      entry.rrf += 1 / (k + rank + 1);
      entry.matchedBy.push(source);
      if (source === 'vector') entry.score = hit.score;
      else entry.keywordScore = hit.keywordScore;
      merged.set(id, entry);
    });
  add(vectorHits, 'vector');
  add(keywordHits, 'keyword');
  const fused = [...merged.values()].sort((a, b) => b.rrf - a.rrf);
  return limit ? fused.slice(0, limit) : fused;
}

let warnedNoTextIndex = false;

/**
 * @param {string} query
 * @param {{topK?: number, documentIds?: string[], mode?: 'hybrid'|'vector'|'keyword'}} options
 */
export async function searchChunks(query, { topK = config.topK, documentIds, mode = config.searchMode } = {}) {
  let results;
  if (mode === 'vector') {
    results = (await vectorSearch(query, { limit: topK, documentIds })).map((h) => ({ ...h, matchedBy: ['vector'] }));
  } else if (mode === 'keyword') {
    results = (await keywordSearch(query, { limit: topK, documentIds })).map((h) => ({ ...h, score: null, matchedBy: ['keyword'] }));
  } else {
    // Over-fetch from each side so fusion has candidates to choose from.
    const pool = topK * 3;
    const [vectorHits, keywordHits] = await Promise.all([
      vectorSearch(query, { limit: pool, documentIds }),
      keywordSearch(query, { limit: pool, documentIds }).catch((err) => {
        if (!warnedNoTextIndex) {
          console.warn(`Keyword search unavailable, using vector only (${err.message}). Run: npm run cli -- setup`);
          warnedNoTextIndex = true;
        }
        return [];
      }),
    ]);
    results = fuseRankings(vectorHits, keywordHits, { limit: topK });
  }

  const docs = await Document.find({ _id: { $in: [...new Set(results.map((r) => String(r.documentId)))] } })
    .select('filename title')
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  return results.map((r) => ({
    chunkId: String(r._id),
    score: r.score ?? null, // vector similarity (0..1), null for keyword-only matches
    keywordScore: r.keywordScore ?? null,
    matchedBy: r.matchedBy,
    text: r.text,
    section: r.section,
    pageStart: r.pageStart,
    pageEnd: r.pageEnd,
    regions: r.regions,
    documentId: String(r.documentId),
    filename: byId.get(String(r.documentId))?.filename ?? 'unknown',
    title: byId.get(String(r.documentId))?.title ?? '',
  }));
}
