const mongoose = require('mongoose');

const ClientTransferSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    fromLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', default: null },
    toLocationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Location', required: true },
    transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: '' },
    isTemporary: { type: Boolean, default: false },
    scheduledReturnDate: { type: Date, default: null },
    actualReturnDate: { type: Date, default: null },
    expiredAssignments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Assignment' }],
    status: {
      type: String,
      enum: ['active', 'returned', 'cancelled'],
      default: 'active'
    }
  },
  { timestamps: true }
);

ClientTransferSchema.index({ orgId: 1, clientId: 1, createdAt: -1 });
ClientTransferSchema.index({ toLocationId: 1, createdAt: -1 });

module.exports = mongoose.model('ClientTransfer', ClientTransferSchema);
