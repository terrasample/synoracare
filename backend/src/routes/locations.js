const express = require('express');
const Location = require('../models/Location');
const Client = require('../models/Client');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const { canRole } = require('../config/accessControl');

const router = express.Router();

function getSupervisorLocationIds(user) {
  return Array.isArray(user?.locationIds) ? user.locationIds.map((id) => String(id)) : [];
}

function supervisorCanAccessLocation(user, locationId) {
  if (String(user?.role || '') !== 'supervisor') return true;
  const allowed = getSupervisorLocationIds(user);
  return allowed.includes(String(locationId));
}

// List all homes for the organization
router.get('/', requireAuth, requirePermissions('homes:read'), async (req, res) => {
  try {
    const query = { orgId: req.user.orgId };
    if (String(req.user.role || '') === 'supervisor') {
      const allowedLocationIds = getSupervisorLocationIds(req.user);
      if (!allowedLocationIds.length) return res.json({ locations: [] });
      query._id = { $in: allowedLocationIds };
    }

    const locations = await Location.find(query)
      .sort({ status: 1, name: 1 })
      .lean();
    return res.json({ locations });
  } catch (error) {
    console.error('Error listing locations:', error);
    return res.status(500).json({ error: 'Failed to list homes' });
  }
});

// Get a specific home with client count
router.get('/:id', requireAuth, requirePermissions('homes:read'), async (req, res) => {
  try {
    if (!supervisorCanAccessLocation(req.user, req.params.id)) {
      return res.status(404).json({ error: 'Home not found' });
    }

    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    const clientCount = await Client.countDocuments({
      locationId: location._id,
      status: 'active'
    });

    return res.json({
      location,
      clientCount,
      canAccommodate: location.maxClients - clientCount
    });
  } catch (error) {
    console.error('Error getting location:', error);
    return res.status(500).json({ error: 'Failed to get home' });
  }
});

// List active clients assigned to a specific home
router.get('/:id/clients', requireAuth, requirePermissions('homes:read'), async (req, res) => {
  try {
    if (!supervisorCanAccessLocation(req.user, req.params.id)) {
      return res.status(404).json({ error: 'Home not found' });
    }

    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId }).lean();
    if (!location) return res.status(404).json({ error: 'Home not found' });

    const clients = await Client.find({
      orgId: req.user.orgId,
      locationId: location._id,
      status: 'active'
    })
      .sort({ displayName: 1 })
      .lean();

    return res.json({ location, clients });
  } catch (error) {
    console.error('Error listing home clients:', error);
    return res.status(500).json({ error: 'Failed to list home clients' });
  }
});

// Create a new home
router.post('/', requireAuth, requirePermissions('homes:create'), async (req, res) => {
  try {
    const { name, displayName, address, phoneNumber, maxClients, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });

    const location = await Location.create({
      orgId: req.user.orgId,
      name,
      displayName: displayName || name,
      address: address || '',
      phoneNumber: phoneNumber || '',
      maxClients: maxClients || 4,
      notes: notes || ''
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'location_created',
        locationName: location.name,
        maxClients: location.maxClients
      }
    });

    return res.status(201).json({ location });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Home name already exists in this organization' });
    }
    console.error('Error creating location:', error);
    return res.status(500).json({ error: 'Failed to create home' });
  }
});

// Update a home
router.put('/:id', requireAuth, requirePermissions('homes:update'), async (req, res) => {
  try {
    const { name, displayName, address, phoneNumber, maxClients, notes } = req.body || {};

    if (!supervisorCanAccessLocation(req.user, req.params.id)) {
      return res.status(404).json({ error: 'Home not found' });
    }
    
    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    // Check if new name already exists (unless it's the same as current)
    if (name && name !== location.name) {
      const existing = await Location.findOne({ orgId: req.user.orgId, name });
      if (existing) return res.status(409).json({ error: 'Home name already exists' });
    }

    if (name) location.name = String(name).trim();
    if (displayName !== undefined) location.displayName = String(displayName).trim();
    if (address !== undefined) location.address = String(address).trim();
    if (phoneNumber !== undefined) location.phoneNumber = String(phoneNumber).trim();
    if (maxClients) location.maxClients = Math.max(1, Math.min(10, maxClients));
    if (notes !== undefined) location.notes = String(notes).trim();

    await location.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'location_updated',
        locationName: location.name
      }
    });

    return res.json({ location });
  } catch (error) {
    console.error('Error updating location:', error);
    return res.status(500).json({ error: 'Failed to update home' });
  }
});

// Archive a home
router.patch('/:id/archive', requireAuth, requirePermissions('homes:archive'), async (req, res) => {
  try {
    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    // Check for active clients at this location
    const activeClients = await Client.countDocuments({
      locationId: location._id,
      status: 'active'
    });

    if (activeClients > 0) {
      return res.status(409).json({
        error: `Cannot archive home with ${activeClients} active client(s). Archive clients first.`
      });
    }

    location.status = 'inactive';
    await location.save();

    // Remove location from all users' locationIds
    await User.updateMany(
      { orgId: req.user.orgId, locationIds: location._id },
      { $pull: { locationIds: location._id } }
    );

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'location_archived',
        locationName: location.name
      }
    });

    return res.json({ location });
  } catch (error) {
    console.error('Error archiving location:', error);
    return res.status(500).json({ error: 'Failed to archive home' });
  }
});

// Assign staff to a home
router.post('/:id/staff/:userId', requireAuth, requirePermissions('homes:manage'), async (req, res) => {
  try {
    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    const user = await User.findOne({ _id: req.params.userId, orgId: req.user.orgId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Only allow DSP and Supervisor roles to be location-assigned
    if (!['dsp', 'supervisor'].includes(user.role)) {
      return res.status(400).json({ error: 'Only DSPs and Supervisors can be assigned to homes' });
    }

    if (!user.locationIds.includes(location._id)) {
      user.locationIds.push(location._id);
      await user.save();
    }

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'user_assigned_to_location',
        userName: user.fullName,
        locationName: location.name
      }
    });

    return res.json({ user });
  } catch (error) {
    console.error('Error assigning staff:', error);
    return res.status(500).json({ error: 'Failed to assign staff to home' });
  }
});

// Remove staff from a home
router.delete('/:id/staff/:userId', requireAuth, requirePermissions('homes:manage'), async (req, res) => {
  try {
    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    const user = await User.findOne({ _id: req.params.userId, orgId: req.user.orgId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.locationIds = user.locationIds.filter(lid => !lid.equals(location._id));
    await user.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'user_removed_from_location',
        userName: user.fullName,
        locationName: location.name
      }
    });

    return res.json({ user });
  } catch (error) {
    console.error('Error removing staff:', error);
    return res.status(500).json({ error: 'Failed to remove staff from home' });
  }
});

// Get staff assigned to a home
router.get('/:id/staff', requireAuth, requirePermissions('homes:read'), async (req, res) => {
  try {
    if (!supervisorCanAccessLocation(req.user, req.params.id)) {
      return res.status(404).json({ error: 'Home not found' });
    }

    const location = await Location.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!location) return res.status(404).json({ error: 'Home not found' });

    const staff = await User.find({
      orgId: req.user.orgId,
      locationIds: location._id,
      status: 'active'
    }).select('fullName email role').lean();

    return res.json({ staff });
  } catch (error) {
    console.error('Error getting staff:', error);
    return res.status(500).json({ error: 'Failed to get staff' });
  }
});

module.exports = router;
