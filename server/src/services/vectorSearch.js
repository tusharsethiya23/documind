/** Retrieval with MongoDB Atlas Vector Search. */
import mongoose from 'mongoose';
import { config } from '../config.js';
import { Chunk } from '../models/Chunk.js';
import { Document } from '../models/Document.js';
import { embedQuery } from './embeddings.js';

export const vectorIndexDefinition = () => ({
  name: config.vectorIndexName,
  type: 'vectorSearch',
  definition: {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: config.embedDimensions, similarity: 'cosine' },
      { type: 'filter', path: 'documentId' },
    ],
  },
});

/** Create the Atlas Vector Search index if it doesn't exist yet. */
export async function ensureVectorIndex() {
  await Chunk.createCollection().catch(() => {}); // already exists is fine
  const collection = Chunk.collection;
  const existing = await collection.listSearchIndexes(config.vectorIndexName).toArray();
  if (existing.length) return { created: false, status: existing[0].status };
  await collection.createSearchIndex(vectorIndexDefinition());
  return { created: true, status: 'PENDING' };
}

export async function vectorIndexStatus() {
  const [index] = await Chunk.collection.listSearchIndexes(config.vectorIndexName).toArray();
  return index ? { status: index.status, queryable: index.queryable } : null;
}

/**
 * @param {string} query
 * @param {{topK?: number, documentIds?: string[]}} options
 * @returns {Promise<Array<{chunkId, score, text, section, pageStart, pageEnd, regions, documentId, filename, title}>>}
 */
export async function searchChunks(query, { topK = config.topK, documentIds } = {}) {
  const queryVector = await embedQuery(query);
  const vectorSearch = {
    index: config.vectorIndexName,
    path: 'embedding',
    queryVector,
    numCandidates: Math.max(100, topK * 20),
    limit: topK,
  };
  if (documentIds?.length) {
    vectorSearch.filter = { documentId: { $in: documentIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  }

  const results = await Chunk.aggregate([
    { $vectorSearch: vectorSearch },
    {
      $project: {
        _id: 1,
        documentId: 1,
        text: 1,
        section: 1,
        pageStart: 1,
        pageEnd: 1,
        regions: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);

  const docs = await Document.find({ _id: { $in: [...new Set(results.map((r) => String(r.documentId)))] } })
    .select('filename title')
    .lean();
  const byId = new Map(docs.map((d) => [String(d._id), d]));

  return results.map((r) => ({
    chunkId: String(r._id),
    score: r.score,
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
