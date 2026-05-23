const mongoose = require('mongoose');

const InviteTokenSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: {
      type: String,
      enum: ['org_admin', 'supervisor', 'dsp'],
      required: true
    },
    tokenHash: { type: String, required: true, unique: true, index: true },
    usedAt: { type: Date, default: null },
    expiresAt: { type: Date, required: true, index: true }
  },
  { timestamps: true }
);

InviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('InviteToken', InviteTokenSchema);
