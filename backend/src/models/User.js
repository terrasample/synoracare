const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['super_admin', 'org_admin', 'supervisor', 'dsp'],
      required: true
    },
    locationIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Location' }],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    },
    inviteAcceptedAt: { type: Date, default: null },
    termsAcceptedAt: { type: Date, default: null },
    mfaEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

UserSchema.index({ orgId: 1, email: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
