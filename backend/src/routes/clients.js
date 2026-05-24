const express = require('express');
const Client = require('../models/Client');
const Assignment = require('../models/Assignment');
const TrackerEntry = require('../models/TrackerEntry');
const CareDocument = require('../models/CareDocument');
const AuditEvent = require('../models/AuditEvent');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    if (['super_admin', 'org_admin', 'supervisor'].includes(req.user.role)) {
      const clients = await Client.find({ orgId: req.user.orgId })
        .sort({ status: 1, displayName: 1 })
        .lean();
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
    const clients = await Client.find({ orgId: req.user.orgId, _id: { $in: clientIds }, status: 'active' })
      .sort({ displayName: 1 })
      .lean();
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

router.put('/:id', requireAuth, requireRoles('super_admin', 'org_admin'), async (req, res) => {
  try {
    const { displayName, externalId, notes } = req.body || {};
    if (!displayName || !String(displayName).trim()) {
      return res.status(400).json({ error: 'displayName required' });
    }

    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    client.displayName = String(displayName).trim();
    client.externalId = String(externalId || '').trim();
    client.notes = String(notes || '').trim();
    await client.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: client._id,
      eventType: 'security_alert',
      payload: {
        action: 'client_updated',
        displayName: client.displayName,
        externalId: client.externalId
      }
    });

    return res.json({ client });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update client' });
  }
});

router.patch('/:id/archive', requireAuth, requireRoles('super_admin'), async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const now = new Date();
    const assignmentResult = await Assignment.updateMany(
      {
        orgId: req.user.orgId,
        clientId: client._id,
        startsAt: { $lte: now },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
      },
      { $set: { expiresAt: now } }
    );

    client.status = 'inactive';
    await client.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: client._id,
      eventType: 'security_alert',
      payload: {
        action: 'client_archived',
        displayName: client.displayName,
        expiredAssignments: assignmentResult.modifiedCount || 0
      }
    });

    return res.json({ client, expiredAssignments: assignmentResult.modifiedCount || 0 });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to archive client' });
  }
});

router.delete('/:id', requireAuth, requireRoles('super_admin'), async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const [assignmentCount, trackerCount, documentCount] = await Promise.all([
      Assignment.countDocuments({ orgId: req.user.orgId, clientId: client._id }),
      TrackerEntry.countDocuments({ orgId: req.user.orgId, clientId: client._id }),
      CareDocument.countDocuments({ orgId: req.user.orgId, clientId: client._id })
    ]);

    if (assignmentCount > 0 || trackerCount > 0 || documentCount > 0) {
      return res.status(409).json({
        error: 'Client cannot be permanently deleted because linked records exist. Archive this client instead.',
        dependencyCounts: {
          assignments: assignmentCount,
          trackerEntries: trackerCount,
          documents: documentCount
        }
      });
    }

    await Client.deleteOne({ _id: client._id, orgId: req.user.orgId });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'client_deleted',
        clientId: String(client._id),
        displayName: client.displayName
      }
    });

    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete client' });
  }
});

module.exports = router;
