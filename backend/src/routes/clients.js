const express = require('express');
const Client = require('../models/Client');
const Assignment = require('../models/Assignment');
const TrackerEntry = require('../models/TrackerEntry');
const CareDocument = require('../models/CareDocument');
const AuditEvent = require('../models/AuditEvent');
const ClientTransfer = require('../models/ClientTransfer');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const { canRole } = require('../config/accessControl');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    if (canRole(req.user.role, 'clients:all:read')) {
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

router.post('/', requireAuth, requirePermissions('clients:create'), async (req, res) => {
  try {
    const { displayName, externalId, notes, locationId } = req.body || {};
    if (!displayName) return res.status(400).json({ error: 'displayName required' });

    const client = await Client.create({
      orgId: req.user.orgId,
      displayName,
      externalId: externalId || '',
      notes: notes || '',
      locationId: locationId || null
    });

    return res.status(201).json({ client });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create client' });
  }
});

router.put('/:id', requireAuth, requirePermissions('clients:update'), async (req, res) => {
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

router.patch('/:id/archive', requireAuth, requirePermissions('clients:archive'), async (req, res) => {
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

router.delete('/:id', requireAuth, requirePermissions('clients:delete'), async (req, res) => {
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

// Transfer a client to a different home
router.post('/:id/transfer', requireAuth, requirePermissions('clients:update'), async (req, res) => {
  try {
    const { toLocationId, reason, isTemporary, scheduledReturnDate } = req.body || {};
    if (!toLocationId) return res.status(400).json({ error: 'toLocationId required' });

    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Verify target location exists and is active
    const Location = require('../models/Location');
    const targetLocation = await Location.findOne({ _id: toLocationId, orgId: req.user.orgId, status: 'active' });
    if (!targetLocation) return res.status(404).json({ error: 'Target home not found or inactive' });

    // If same location, return error
    if (String(client.locationId) === String(toLocationId)) {
      return res.status(400).json({ error: 'Client is already in this home' });
    }

    const now = new Date();
    const fromLocationId = client.locationId || null;

    // Expire all current active assignments for this client
    const expiredAssignments = await Assignment.find({
      orgId: req.user.orgId,
      clientId: client._id,
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    }).select('_id').lean();

    const expiredIds = expiredAssignments.map((a) => a._id);

    if (expiredIds.length > 0) {
      await Assignment.updateMany(
        { _id: { $in: expiredIds } },
        { $set: { expiresAt: now } }
      );
    }

    // Create transfer record
    const transfer = await ClientTransfer.create({
      orgId: req.user.orgId,
      clientId: client._id,
      fromLocationId,
      toLocationId,
      transferredBy: req.user._id,
      reason: String(reason || '').trim(),
      isTemporary: Boolean(isTemporary),
      scheduledReturnDate: isTemporary && scheduledReturnDate ? new Date(scheduledReturnDate) : null,
      expiredAssignments: expiredIds,
      status: 'active'
    });

    // Update client location
    client.locationId = toLocationId;
    await client.save();

    // Audit log
    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: client._id,
      eventType: 'security_alert',
      payload: {
        action: 'client_transferred',
        clientName: client.displayName,
        fromLocationId: String(fromLocationId || 'none'),
        toLocationId: String(toLocationId),
        isTemporary,
        scheduledReturnDate: transfer.scheduledReturnDate || null,
        expiredAssignmentCount: expiredIds.length
      }
    });

    return res.status(201).json({ client, transfer });
  } catch (error) {
    console.error('Error transferring client:', error);
    return res.status(500).json({ error: 'Failed to transfer client' });
  }
});

// Get transfer history for a client
router.get('/:id/transfers', requireAuth, async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const transfers = await ClientTransfer.find({
      orgId: req.user.orgId,
      clientId: client._id
    })
      .sort({ createdAt: -1 })
      .populate('fromLocationId', 'name displayName')
      .populate('toLocationId', 'name displayName')
      .populate('transferredBy', 'fullName email')
      .lean();

    return res.json({ transfers });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch transfer history' });
  }
});

// Complete a temporary transfer (return to original home)
router.post('/:id/transfers/:transferId/return', requireAuth, requirePermissions('clients:update'), async (req, res) => {
  try {
    const transfer = await ClientTransfer.findOne({
      _id: req.params.transferId,
      clientId: req.params.id,
      orgId: req.user.orgId
    });
    if (!transfer) return res.status(404).json({ error: 'Transfer record not found' });

    if (transfer.status !== 'active') {
      return res.status(400).json({ error: 'Transfer is no longer active' });
    }

    if (!transfer.isTemporary || !transfer.fromLocationId) {
      return res.status(400).json({ error: 'Only temporary transfers can be returned' });
    }

    const now = new Date();
    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Expire current assignments
    await Assignment.updateMany(
      {
        orgId: req.user.orgId,
        clientId: client._id,
        startsAt: { $lte: now },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
      },
      { $set: { expiresAt: now } }
    );

    // Return to original location
    client.locationId = transfer.fromLocationId;
    await client.save();

    // Update transfer record
    transfer.status = 'returned';
    transfer.actualReturnDate = now;
    await transfer.save();

    // Audit log
    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: client._id,
      eventType: 'security_alert',
      payload: {
        action: 'client_returned_to_home',
        clientName: client.displayName,
        returnedToLocationId: String(transfer.fromLocationId)
      }
    });

    return res.json({ client, transfer });
  } catch (error) {
    console.error('Error returning client:', error);
    return res.status(500).json({ error: 'Failed to return client to home' });
  }
});

module.exports = router;
