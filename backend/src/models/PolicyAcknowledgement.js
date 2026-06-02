const mongoose = require('mongoose');

const PolicyAcknowledgementSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    policySlug: { type: String, required: true, trim: true, lowercase: true },
    note: { type: String, default: '', trim: true },
    acknowledgedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

PolicyAcknowledgementSchema.index({ orgId: 1, userId: 1, policyId: 1 }, { unique: true });

module.exports = mongoose.model('PolicyAcknowledgement', PolicyAcknowledgementSchema);
