const mongoose = require('mongoose');

const LocationSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    name: { type: String, required: true, trim: true },
    displayName: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    phoneNumber: { type: String, default: '', trim: true },
    maxClients: { type: Number, default: 4, min: 1, max: 10 },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

LocationSchema.index({ orgId: 1, name: 1 }, { unique: true });
LocationSchema.index({ orgId: 1, status: 1 });

module.exports = mongoose.model('Location', LocationSchema);
