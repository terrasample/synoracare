const mongoose = require('mongoose');

const OrganizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true },
    stateCode: { type: String, default: '', trim: true, uppercase: true, maxlength: 2 },
    roleDisplayLabels: {
      dsp: { type: String, trim: true, maxlength: 60, default: '' },
      supervisor: { type: String, trim: true, maxlength: 60, default: '' },
      org_admin: { type: String, trim: true, maxlength: 60, default: '' },
      super_admin: { type: String, trim: true, maxlength: 60, default: '' }
    },
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
