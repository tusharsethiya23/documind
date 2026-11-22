import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { HttpError, validateId } from '../middleware/errors.js';
import { Document } from '../models/Document.js';
import { createDocument, deleteDocument, processDocument } from '../services/indexer.js';
import { openPdf } from '../services/storage.js';

/** In the public demo (READ_ONLY=true) visitors can ask questions but not change the library. */
function rejectIfReadOnly(_req, _res, next) {
  if (config.readOnly) return next(new HttpError(403, 'This is a read-only demo: uploading and deleting are turned off.'));
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
    cb(isPdf ? null : new HttpError(400, 'Only PDF files are supported.'), isPdf);
  },
});

/** What the client sees: no file paths or hashes. */
export const toPublic = (d) => ({
  id: String(d._id),
  filename: d.filename,
  title: d.title,
  numPages: d.numPages,
  numChunks: d.numChunks,
  status: d.status,
  error: d.error ?? null,
  createdAt: d.createdAt,
});

const router = Router();

router.get('/', async (_req, res) => {
  const docs = await Document.find().sort({ createdAt: -1 }).lean();
  res.json({ documents: docs.map(toPublic) });
});

router.post('/', rejectIfReadOnly, upload.single('file'), async (req, res) => {
  if (!req.file) throw new HttpError(400, 'Attach a PDF in the "file" field.');
  const { buffer, originalname } = req.file;
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw new HttpError(400, 'That file is not a valid PDF.');

  const { document, skipped } = await createDocument(buffer, originalname, { force: req.query.force === 'true' });
  if (skipped) return res.status(200).json({ document: toPublic(document), skipped: true });

  // Index in the background; the client polls GET /api/documents/:id for status.
  processDocument(document, buffer).catch((err) => console.error(`Indexing ${originalname} failed:`, err.message));
  res.status(202).json({ document: toPublic(document), skipped: false });
});

router.get('/:id', validateId, async (req, res) => {
  const doc = await Document.findById(req.params.id).lean();
  if (!doc) throw new HttpError(404, 'Document not found.');
  res.json({ document: toPublic(doc) });
});

/** The original PDF, for the viewer (streamed from GridFS). */
router.get('/:id/file', validateId, async (req, res) => {
  const doc = await Document.findById(req.params.id).lean();
  if (!doc) throw new HttpError(404, 'Document not found.');
  const file = await openPdf(doc.fileHash);
  if (!file) throw new HttpError(404, 'The PDF file is missing. Run: npm run cli -- migrate-files');
  res.type('application/pdf');
  res.setHeader('Content-Length', file.length);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  // Content never changes for a given document (it is keyed by content hash).
  res.setHeader('Cache-Control', 'private, max-age=86400');
  await pipeline(file.stream, res);
});

router.delete('/:id', validateId, rejectIfReadOnly, async (req, res) => {
  const doc = await Document.findById(req.params.id).lean();
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (doc.status === 'processing') throw new HttpError(409, 'This document is still being indexed. Try again when it finishes.');
  await deleteDocument(doc._id);
  res.status(204).end();
});

export default router;
