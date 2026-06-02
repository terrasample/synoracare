const mongoose = require('mongoose');

const PolicyEmailNotificationSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    policyId: { type: mongoose.Schema.Types.ObjectId, ref: 'PolicyDocument', required: true, index: true },
    toEmail: { type: String, required: true, trim: true, lowercase: true },
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    status: { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
    sentAt: { type: Date, default: null },
    error: { type: String, default: '' }
  },
  { timestamps: true }
);

PolicyEmailNotificationSchema.index({ orgId: 1, userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('PolicyEmailNotification', PolicyEmailNotificationSchema);
