/**
 * PDF file storage in MongoDB GridFS.
 *
 * Free hosting (and containers in general) can lose their disk on restart, so
 * the original PDFs live in the database next to their chunks. Files are keyed
 * by content hash: `<sha256>.pdf`.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import mongoose from 'mongoose';
import { config } from '../config.js';

const bucket = () => new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'pdfs' });
const nameFor = (fileHash) => `${fileHash}.pdf`;

async function findFile(fileHash) {
  const [file] = await bucket().find({ filename: nameFor(fileHash) }).limit(1).toArray();
  return file ?? null;
}

export async function savePdf(fileHash, buffer) {
  if (await findFile(fileHash)) return; // same content already stored
  await pipeline(Readable.from(buffer), bucket().openUploadStream(nameFor(fileHash), { contentType: 'application/pdf' }));
}

/** @returns {Promise<{stream: import('node:stream').Readable, length: number} | null>} */
export async function openPdf(fileHash) {
  const file = await findFile(fileHash);
  if (!file) return null;
  return { stream: bucket().openDownloadStream(file._id), length: file.length };
}

export async function deletePdf(fileHash) {
  const files = await bucket().find({ filename: nameFor(fileHash) }).toArray();
  await Promise.all(files.map((f) => bucket().delete(f._id)));
}

/**
 * One-time move of PDFs saved by older versions (in the uploads folder) into GridFS.
 * @returns {Promise<{moved: number, missing: string[]}>}
 */
export async function migrateDiskFiles(documents) {
  let moved = 0;
  const missing = [];
  for (const doc of documents) {
    if (await findFile(doc.fileHash)) continue;
    const file = path.join(config.uploadsDir, nameFor(doc.fileHash));
    const buffer = await fs.readFile(file).catch(() => null);
    if (!buffer) {
      missing.push(doc.filename);
      continue;
    }
    await savePdf(doc.fileHash, buffer);
    moved++;
  }
  return { moved, missing };
}
