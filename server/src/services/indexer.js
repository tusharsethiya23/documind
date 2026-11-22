/**
 * Indexing pipeline: PDF -> blocks -> chunks -> embeddings -> MongoDB.
 *
 * Split in two so the API can answer an upload immediately:
 *   createDocument()  saves the file and a "processing" record (fast)
 *   processDocument() parses, chunks and embeds it (slow; run in background)
 * indexPdf() does both and waits, which is what the CLI uses.
 */
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
 * Where a document's PDF lives. Derived from the content hash and the configured
 * uploads folder (not a stored absolute path), so it works on any machine or container.
 */
export const pdfPath = (doc) => path.join(config.uploadsDir, `${doc.fileHash}.pdf`);

/**
 * Store the PDF and create its record. Returns the existing record instead
 * when the same file is already indexed (unless `force`).
 * @returns {Promise<{document: object, skipped: boolean}>}
 */
export async function createDocument(buffer, filename, { force = false } = {}) {
  const fileHash = sha256(buffer);
  const existing = await Document.findOne({ fileHash });
  if (existing && !force && existing.status !== 'failed') return { document: existing, skipped: true };
  if (existing) await deleteDocument(existing._id);

  await fs.mkdir(config.uploadsDir, { recursive: true });
  const storagePath = path.join(config.uploadsDir, `${fileHash}.pdf`);
  await fs.writeFile(storagePath, buffer);

  const document = await Document.create({
    fileHash,
    filename,
    title: filename.replace(/\.pdf$/i, ''),
    storagePath,
    status: 'processing',
  });
  return { document, skipped: false };
}

/** Parse, chunk, embed and store. Marks the record "ready" or "failed". */
export async function processDocument(document, buffer, { onProgress = () => {} } = {}) {
  try {
    onProgress('parsing');
    const parsed = await parsePdf(buffer, document.filename);
    const chunks = chunkDocument(parsed, { chunkChars: config.chunkChars, overlapChars: config.chunkOverlapChars });
    if (!chunks.length) {
      throw new Error('No text found. It may be a scanned PDF (OCR is not supported yet).');
    }

    onProgress(`embedding ${chunks.length} chunks`);
    const vectors = await embedPassages(chunks.map((c) => embeddingText(c, parsed.title)));
    const docs = chunks.map((c, i) => ({ ...c, documentId: document._id, embedding: vectors[i] }));
    for (let i = 0; i < docs.length; i += INSERT_BATCH) {
      await Chunk.insertMany(docs.slice(i, i + INSERT_BATCH), { ordered: true });
    }

    Object.assign(document, {
      title: parsed.title,
      numPages: parsed.numPages,
      numChunks: chunks.length,
      status: 'ready',
      error: undefined,
    });
    await document.save();
    return document;
  } catch (err) {
    await Chunk.deleteMany({ documentId: document._id });
    document.status = 'failed';
    document.error = err.message;
    await document.save();
    throw err;
  }
}

/** Index one PDF and wait for it to finish (used by the CLI). */
export async function indexPdf(buffer, filename, { force = false, onProgress } = {}) {
  const { document, skipped } = await createDocument(buffer, filename, { force });
  if (skipped) return { document, skipped };
  await processDocument(document, buffer, { onProgress });
  return { document, skipped: false };
}

/** After a crash or restart, documents left "processing" will never finish. */
export async function failInterruptedDocuments() {
  const { modifiedCount } = await Document.updateMany(
    { status: 'processing' },
    { status: 'failed', error: 'Indexing was interrupted. Upload the file again.' },
  );
  return modifiedCount;
}

export async function deleteDocument(documentId) {
  const doc = await Document.findById(documentId);
  if (!doc) return false;
  await Chunk.deleteMany({ documentId: doc._id });
  await Document.deleteOne({ _id: doc._id });
  await fs.rm(pdfPath(doc), { force: true });
  return true;
}
