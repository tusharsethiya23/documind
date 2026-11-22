import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    fileHash: { type: String, required: true, unique: true }, // sha256 of the PDF bytes
    filename: { type: String, required: true },
    title: { type: String, required: true },
    numPages: { type: Number, default: 0 },
    numChunks: { type: Number, default: 0 },
    // The PDF itself is stored in GridFS (bucket "pdfs") as `<fileHash>.pdf`.
    // storagePath is a leftover from disk storage, kept so old records still load.
    storagePath: { type: String },
    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
    error: { type: String },
  },
  { timestamps: true },
);

export const Document = mongoose.model('Document', documentSchema);
