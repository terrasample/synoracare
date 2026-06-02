const mongoose = require('mongoose');

const PolicyContactSchema = new mongoose.Schema(
  {
    role: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    email: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const PolicyDocumentSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    category: {
      type: String,
      enum: ['health-and-safety', 'incident-response', 'workers-comp', 'compliance', 'operations'],
      default: 'incident-response'
    },
    incidentTypes: { type: [String], default: [] },
    appliesTo: { type: [String], default: [] },
    summary: { type: String, default: '' },
    immediateActions: { type: [String], default: [] },
    procedureSteps: { type: [String], default: [] },
    reportingRequirements: { type: [String], default: [] },
    contacts: { type: [PolicyContactSchema], default: [] },
    version: { type: String, default: '1.0' },
    currentVersion: { type: Number, default: 1 },
    effectiveDate: { type: Date, default: Date.now },
    lastReviewedAt: { type: Date, default: Date.now },
    workflowStatus: {
      type: String,
      enum: ['draft', 'in_review', 'published', 'archived'],
      default: 'draft'
    },
    submittedForReviewAt: { type: Date, default: null },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    publishedAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
  },
  { timestamps: true }
);

PolicyDocumentSchema.index({ orgId: 1, slug: 1 }, { unique: true });
PolicyDocumentSchema.index({ orgId: 1, isActive: 1, category: 1 });
PolicyDocumentSchema.index({ title: 'text', summary: 'text', procedureSteps: 'text' });

module.exports = mongoose.model('PolicyDocument', PolicyDocumentSchema);
