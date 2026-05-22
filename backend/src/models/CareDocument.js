const mongoose = require('mongoose');

const CareDocumentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    docType: {
      type: String,
      enum: ['isp', 'mar', 'behavior', 'care-plan', 'other'],
      default: 'other'
    },
    title: { type: String, required: true, trim: true },
    sourceFileName: { type: String, required: true },
    effectiveDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    extractedText: { type: String, default: '' },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: true }
);

CareDocumentSchema.index({ orgId: 1, clientId: 1, isActive: 1, docType: 1 });

module.exports = mongoose.model('CareDocument', CareDocumentSchema);
