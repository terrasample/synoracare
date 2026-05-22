const mongoose = require('mongoose');

const CareChunkSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CareDocument', required: true, index: true },
    chunkIndex: { type: Number, required: true },
    content: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    sourceMeta: {
      pageHint: { type: String, default: '' },
      sectionHint: { type: String, default: '' },
      sourceFileName: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

CareChunkSchema.index({ orgId: 1, clientId: 1, documentId: 1, chunkIndex: 1 }, { unique: true });

module.exports = mongoose.model('CareChunk', CareChunkSchema);
