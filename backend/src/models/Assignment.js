const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startsAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, default: null, index: true },
    isBreakGlass: { type: Boolean, default: false, index: true },
    breakGlassReason: { type: String, default: '' }
  },
  { timestamps: true }
);

AssignmentSchema.index({ orgId: 1, userId: 1, clientId: 1 }, { unique: true });

module.exports = mongoose.model('Assignment', AssignmentSchema);
