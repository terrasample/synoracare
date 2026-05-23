const express = require('express');
const Client = require('../models/Client');
const Assignment = require('../models/Assignment');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    if (['super_admin', 'org_admin', 'supervisor'].includes(req.user.role)) {
      const clients = await Client.find({ orgId: req.user.orgId }).sort({ displayName: 1 }).lean();
      return res.json({ clients });
    }

    const now = new Date();
    const assigned = await Assignment.find({
      orgId: req.user.orgId,
      userId: req.user._id,
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    }).lean();
    const clientIds = assigned.map((a) => a.clientId);
    const clients = await Client.find({ orgId: req.user.orgId, _id: { $in: clientIds } }).sort({ displayName: 1 }).lean();
    return res.json({ clients });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list clients' });
  }
});

router.post('/', requireAuth, requireRoles('super_admin', 'org_admin', 'supervisor'), async (req, res) => {
  try {
    const { displayName, externalId, notes } = req.body || {};
    if (!displayName) return res.status(400).json({ error: 'displayName required' });

    const client = await Client.create({
      orgId: req.user.orgId,
      displayName,
      externalId: externalId || '',
      notes: notes || ''
    });

    return res.status(201).json({ client });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }
});

module.exports = router;
