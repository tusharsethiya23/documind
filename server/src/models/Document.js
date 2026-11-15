import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema(
  {
    fileHash: { type: String, required: true, unique: true }, // sha256 of the PDF bytes
    filename: { type: String, required: true },
    title: { type: String, required: true },
    numPages: { type: Number, required: true },
    numChunks: { type: Number, default: 0 },
    storagePath: { type: String, required: true }, // where the PDF is kept for the viewer
    status: { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
    error: { type: String },
  },
  { timestamps: true },
);

export const Document = mongoose.model('Document', documentSchema);
