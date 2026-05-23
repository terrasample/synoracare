const mongoose = require('mongoose');

const DemoRequestSchema = new mongoose.Schema(
  {
    organizationName: { type: String, required: true, trim: true },
    contactName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    requestType: { type: String, enum: ['demo', 'pilot', 'walkthrough'], default: 'demo' },
    message: { type: String, default: '', trim: true },
    source: { type: String, default: 'web' },
    metadata: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' }
    }
  },
  { timestamps: true }
);

DemoRequestSchema.index({ createdAt: -1 });
DemoRequestSchema.index({ email: 1, createdAt: -1 });
DemoRequestSchema.index({ 'metadata.ip': 1, createdAt: -1 });

module.exports = mongoose.model('DemoRequest', DemoRequestSchema);