/** Indexing pipeline: PDF -> blocks -> chunks -> embeddings -> MongoDB. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { Chunk } from '../models/Chunk.js';
import { Document } from '../models/Document.js';
import { chunkDocument, embeddingText } from './chunker.js';
import { embedPassages } from './embeddings.js';
import { parsePdf, sha256 } from './pdfParser.js';

const INSERT_BATCH = 100;

/**
 * Index one PDF. Re-indexing an unchanged file is a no-op unless `force` is set.
 * @returns {Promise<{document: object, skipped: boolean}>}
 */
export async function indexPdf(buffer, filename, { force = false, onProgress = () => {} } = {}) {
  const fileHash = sha256(buffer);
  const existing = await Document.findOne({ fileHash });
  if (existing?.status === 'ready' && !force) return { document: existing, skipped: true };
  if (existing) await deleteDocument(existing._id);

  onProgress('parsing');
  const parsed = await parsePdf(buffer, filename);
  const chunks = chunkDocument(parsed, { chunkChars: config.chunkChars, overlapChars: config.chunkOverlapChars });
  if (!chunks.length) {
    throw new Error(`No text found in ${filename}. It may be a scanned PDF (OCR is not supported yet).`);
  }

  await fs.mkdir(config.uploadsDir, { recursive: true });
  const storagePath = path.join(config.uploadsDir, `${fileHash}.pdf`);
  await fs.writeFile(storagePath, buffer);

  const document = await Document.create({
    fileHash,
    filename,
    title: parsed.title,
    numPages: parsed.numPages,
    storagePath,
    status: 'processing',
  });

  try {
    onProgress(`embedding ${chunks.length} chunks`);
    const vectors = await embedPassages(chunks.map((c) => embeddingText(c, parsed.title)));
    const docs = chunks.map((c, i) => ({ ...c, documentId: document._id, embedding: vectors[i] }));
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      await Chunk.insertMany(docs.slice(i, i + INSERT_BATCH), { ordered: true });
    }
    document.numChunks = chunks.length;
    document.status = 'ready';
    await document.save();
    return { document, skipped: false };
  } catch (err) {
    document.status = 'failed';
    document.error = err.message;
    await document.save();
    await Chunk.deleteMany({ documentId: document._id });
    throw err;
  }
}

export async function deleteDocument(documentId) {
  const doc = await Document.findById(documentId);
  if (!doc) return false;
  await Chunk.deleteMany({ documentId: doc._id });
  await Document.deleteOne({ _id: doc._id });
  await fs.rm(doc.storagePath, { force: true });
  return true;
}
