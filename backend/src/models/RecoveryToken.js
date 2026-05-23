const mongoose = require('mongoose');

const RecoveryTokenSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    purpose: {
      type: String,
      enum: ['admin_recovery', 'password_reset'],
      default: 'admin_recovery',
      index: true
    },
    fullName: { type: String, default: '', trim: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

RecoveryTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RecoveryToken', RecoveryTokenSchema);