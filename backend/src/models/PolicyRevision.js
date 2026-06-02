const mongoose = require('mongoose');

const PolicyRevisionSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    version: { type: Number, required: true },
    status: { type: String, default: '' },
    changeType: {
      type: String,
      enum: ['create', 'update', 'submit_review', 'publish', 'archive', 'rollback'],
      required: true
    },
    note: { type: String, default: '', trim: true },
    snapshot: { type: Object, default: {} },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }
  },
  { timestamps: true }
);

PolicyRevisionSchema.index({ orgId: 1, policyId: 1, createdAt: -1 });

module.exports = mongoose.model('PolicyRevision', PolicyRevisionSchema);
