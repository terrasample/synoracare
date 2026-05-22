const mongoose = require('mongoose');

const AuditEventSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    eventType: {
      type: String,
      enum: [
        'login',
        'upload_document',
        'ask_question',
        'escalation',
        'forbidden_access',
        'security_alert',
        'break_glass_created',
        'break_glass_access',
        'tracker_entry',
        'tracker_status_update',
        'password_reset',
        'legal_records_export'
      ],
      required: true
    },
    payload: { type: Object, default: {} }
  },
  { timestamps: true }
);

AuditEventSchema.index({ orgId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditEvent', AuditEventSchema);
