const mongoose = require('mongoose');

const TrackerEntrySchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    eventType: {
      type: String,
      enum: ['medication', 'adl', 'behavior', 'incident', 'note', 'handoff'],
      required: true
    },
    priority: {
      type: String,
      enum: ['low', 'normal', 'high', 'urgent'],
      default: 'normal'
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'escalated'],
      default: 'pending',
      index: true
    },
    summary: { type: String, required: true, trim: true, maxlength: 300 },
    details: { type: String, default: '', trim: true, maxlength: 3000 },
    photo: {
      fileName: { type: String, default: '' },
      contentType: { type: String, default: '' },
      size: { type: Number, default: 0 },
      data: { type: Buffer, default: null },
      capturedAt: { type: Date, default: null }
    },
    photoCaption: { type: String, default: '', trim: true, maxlength: 300 },
    dueAt: { type: Date, default: null, index: true },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

TrackerEntrySchema.index({ orgId: 1, clientId: 1, createdAt: -1 });

module.exports = mongoose.model('TrackerEntry', TrackerEntrySchema);
