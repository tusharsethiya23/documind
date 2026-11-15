import mongoose from 'mongoose';

// A rectangle on a PDF page, in PDF units with a top-left origin,
// so the React viewer can draw highlights directly.
const regionSchema = new mongoose.Schema(
  {
    page: Number, // 1-indexed
    x: Number,
    y: Number,
    width: Number,
    height: Number,
  },
  { _id: false },
);

const chunkSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  index: { type: Number, required: true },
  section: { type: String, default: '' },
  text: { type: String, required: true },
  pageStart: { type: Number, required: true },
  pageEnd: { type: Number, required: true },
  regions: [regionSchema],
  embedding: { type: [Number], required: true },
});

chunkSchema.index({ documentId: 1, index: 1 }, { unique: true });

export const Chunk = mongoose.model('Chunk', chunkSchema);
