const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    displayName: { type: String, required: true, trim: true },
    externalId: { type: String, default: '', trim: true },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

ClientSchema.index({ orgId: 1, displayName: 1 });

module.exports = mongoose.model('Client', ClientSchema);
