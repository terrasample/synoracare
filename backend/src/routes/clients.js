const express = require('express');
const mongoose = require('mongoose');
const Client = require('../models/Client');
const Location = require('../models/Location');
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
    if (req.user.role === 'supervisor') {
      const locationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      if (!locationIds.length) return res.json({ clients: [] });

      const clients = await Client.find({
        orgId: req.user.orgId,
        locationId: { $in: locationIds },
        status: 'active'
      })
        .sort({ displayName: 1 })
        .lean();

      return res.json({ clients });
    }

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

    const normalizedLocationId = String(locationId || '').trim() || null;

    if (req.user.role === 'supervisor') {
      if (!normalizedLocationId) {
        return res.status(400).json({ error: 'Supervisors must assign a home when creating a client' });
      }

      const supervisorLocationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      const canUseLocation = supervisorLocationIds.some((id) => String(id) === normalizedLocationId);
      if (!canUseLocation) {
        return res.status(403).json({ error: 'Supervisors can only create clients in their assigned homes' });
      }
    }

    if (normalizedLocationId) {
      if (!mongoose.Types.ObjectId.isValid(normalizedLocationId)) {
        return res.status(400).json({ error: 'Invalid locationId' });
      }

      const location = await Location.findOne({ _id: normalizedLocationId, orgId: req.user.orgId, status: 'active' }).lean();
      if (!location) {
        return res.status(404).json({ error: 'Home not found or inactive' });
      }
    }

    const client = await Client.create({
      orgId: req.user.orgId,
      displayName,
      externalId: externalId || '',
      notes: notes || '',
      locationId: normalizedLocationId
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

    if (req.user.role === 'supervisor') {
      const supervisorLocationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      const canManageClient = supervisorLocationIds.some((id) => String(id) === String(client.locationId || ''));
      if (!canManageClient) {
        return res.status(403).json({ error: 'Supervisors can only edit clients in their assigned homes' });
      }
    }

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

    const temporaryTransfer = Boolean(isTemporary);
    let parsedReturnDate = null;
    if (temporaryTransfer) {
      if (!scheduledReturnDate) {
        return res.status(400).json({ error: 'scheduledReturnDate required for temporary transfer' });
      }
      parsedReturnDate = new Date(scheduledReturnDate);
      if (Number.isNaN(parsedReturnDate.getTime())) {
        return res.status(400).json({ error: 'Invalid scheduledReturnDate' });
      }
      if (parsedReturnDate.getTime() <= Date.now()) {
        return res.status(400).json({ error: 'scheduledReturnDate must be in the future' });
      }
    }

    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (req.user.role === 'supervisor') {
      const supervisorLocationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      const canManageSource = supervisorLocationIds.some((id) => String(id) === String(client.locationId || ''));
      const canManageTarget = supervisorLocationIds.some((id) => String(id) === String(toLocationId || ''));
      if (!canManageSource || !canManageTarget) {
        return res.status(403).json({ error: 'Supervisors can only transfer clients between their assigned homes' });
      }
    }

    // Verify target location exists and is active
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
      isTemporary: temporaryTransfer,
      scheduledReturnDate: parsedReturnDate,
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
router.get('/:id/transfers', requireAuth, requirePermissions('clients:assigned:read'), async (req, res) => {
  try {
    const client = await Client.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (!canRole(req.user.role, 'clients:all:read')) {
      const now = new Date();
      const assignment = await Assignment.findOne({
        orgId: req.user.orgId,
        userId: req.user._id,
        clientId: client._id,
        startsAt: { $lte: now },
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
      })
        .select('_id')
        .lean();
      if (!assignment && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: 'Forbidden' });
      }
    }

    if (req.user.role === 'supervisor') {
      const supervisorLocationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      const canViewClient = supervisorLocationIds.some((id) => String(id) === String(client.locationId || ''));
      if (!canViewClient) {
        return res.status(403).json({ error: 'Supervisors can only view transfer history for clients in their assigned homes' });
      }
    }

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

    if (req.user.role === 'supervisor') {
      const supervisorLocationIds = Array.isArray(req.user.locationIds) ? req.user.locationIds : [];
      const canManageSource = supervisorLocationIds.some((id) => String(id) === String(client.locationId || ''));
      const canManageReturnTarget = supervisorLocationIds.some((id) => String(id) === String(transfer.fromLocationId || ''));
      if (!canManageSource || !canManageReturnTarget) {
        return res.status(403).json({ error: 'Supervisors can only return clients within their assigned homes' });
      }
    }

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
