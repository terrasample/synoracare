const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const AuditEvent = require('../models/AuditEvent');

const router = express.Router();

router.get('/', requireAuth, requirePermissions('audit:org:read'), async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 200), 500);
    const events = await AuditEvent.find({ orgId: req.user.orgId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ events });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load audit events' });
  }
});

module.exports = router;
