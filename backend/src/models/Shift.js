const mongoose = require('mongoose');

const ShiftSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    status: {
      type: String,
      enum: ['active', 'ended', 'cancelled'],
      default: 'active',
      index: true
    },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date, default: null, index: true },
    scheduledEndTime: { type: Date, default: null },
    
    // Shift metadata
    entriesLogged: { type: Number, default: 0 },
    escalationsCount: { type: Number, default: 0 },
    photosCaptured: { type: Number, default: 0 },
    
    // Report data
    reportData: {
      summary: String,
      entriesSnapshot: [
        {
          entryId: mongoose.Schema.Types.ObjectId,
          eventType: String,
          priority: String,
          summary: String,
          status: String,
          createdAt: Date
        }
      ],
      escalations: [
        {
          entryId: mongoose.Schema.Types.ObjectId,
          summary: String,
          timestamp: Date
        }
      ],
      totalDuration: Number, // milliseconds
      performanceMetrics: {
        averageResponseTime: Number,
        completionRate: Number,
        escalationRate: Number
      }
    },
    
    // Report generation
    reportGeneratedAt: { type: Date, default: null },
    reportUrl: { type: String, default: '' }
  },
  { timestamps: true }
);

ShiftSchema.index({ orgId: 1, userId: 1, startedAt: -1 });
ShiftSchema.index({ orgId: 1, clientId: 1, startedAt: -1 });
ShiftSchema.index({ status: 1, startedAt: -1 });

module.exports = mongoose.model('Shift', ShiftSchema);
