const mongoose = require('mongoose');

const PolicyNotificationSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    type: {
      type: String,
      enum: ['policy_published', 'policy_updated', 'policy_archived'],
      required: true
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

PolicyNotificationSchema.index({ orgId: 1, userId: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('PolicyNotification', PolicyNotificationSchema);
