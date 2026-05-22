const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    stateCode: { type: String, default: '', trim: true, uppercase: true, maxlength: 2 },
    legalRetentionYearsOverride: { type: Number, default: null, min: 1, max: 30 },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Organization', OrganizationSchema);
