const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const Organization = require('../models/Organization');
const Location = require('../models/Location');
const User = require('../models/User');
const Client = require('../models/Client');
const TrackerEntry = require('../models/TrackerEntry');

const router = express.Router();

router.use(requireAuth, requireRoles('super_admin'));

// Super admin: list every organization with summary counts.
router.get('/organizations', async (_req, res) => {
  try {
    const organizations = await Organization.find({})
      .sort({ createdAt: -1 })
      .lean();

    const orgIds = organizations.map((org) => org._id);

    const [homeCounts, activeHomeCounts, userCounts] = await Promise.all([
      Location.aggregate([
        { $match: { orgId: { $in: orgIds } } },
        { $group: { _id: '$orgId', count: { $sum: 1 } } }
      ]),
      Location.aggregate([
        { $match: { orgId: { $in: orgIds }, status: 'active' } },
        { $group: { _id: '$orgId', count: { $sum: 1 } } }
      ]),
      User.aggregate([
        { $match: { orgId: { $in: orgIds } } },
        { $group: { _id: '$orgId', count: { $sum: 1 } } }
      ])
    ]);

    const homeCountByOrg = new Map(homeCounts.map((item) => [String(item._id), item.count]));
    const activeHomeCountByOrg = new Map(activeHomeCounts.map((item) => [String(item._id), item.count]));
    const userCountByOrg = new Map(userCounts.map((item) => [String(item._id), item.count]));

    const data = organizations.map((org) => {
      const orgId = String(org._id);
      const totalHomes = homeCountByOrg.get(orgId) || 0;
      const activeHomes = activeHomeCountByOrg.get(orgId) || 0;
      return {
        id: org._id,
        name: org.name,
        slug: org.slug,
        stateCode: org.stateCode || null,
        createdAt: org.createdAt,
        totalHomes,
        activeHomes,
        inactiveHomes: Math.max(0, totalHomes - activeHomes),
        totalUsers: userCountByOrg.get(orgId) || 0
      };
    });

    return res.json({ organizations: data });
  } catch (error) {
    console.error('Error listing organizations for super admin:', error);
    return res.status(500).json({ error: 'Failed to list organizations' });
  }
});

// Super admin: list homes under one organization with active client counts.
router.get('/organizations/:orgId/homes', async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orgId)) {
      return res.status(400).json({ error: 'Invalid organization id' });
    }

    const organization = await Organization.findById(orgId).lean();
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const homes = await Location.find({ orgId: organization._id })
      .sort({ status: 1, name: 1 })
      .lean();

    const locationIds = homes.map((home) => home._id);
    const clientCounts = await Client.aggregate([
      {
        $match: {
          locationId: { $in: locationIds },
          status: 'active'
        }
      },
      {
        $group: {
          _id: '$locationId',
          count: { $sum: 1 }
        }
      }
    ]);

    const activeClientCountByHome = new Map(clientCounts.map((item) => [String(item._id), item.count]));

    const data = homes.map((home) => {
      const activeClients = activeClientCountByHome.get(String(home._id)) || 0;
      return {
        ...home,
        activeClients,
        availableCapacity: Math.max(0, Number(home.maxClients || 0) - activeClients)
      };
    });

    return res.json({
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        stateCode: organization.stateCode || null
      },
      homes: data
    });
  } catch (error) {
    console.error('Error listing organization homes for super admin:', error);
    return res.status(500).json({ error: 'Failed to list organization homes' });
  }
});

// Super admin: update home details under one organization (address-first use case).
router.put('/organizations/:orgId/homes/:homeId', async (req, res) => {
  try {
    const { orgId, homeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orgId) || !mongoose.Types.ObjectId.isValid(homeId)) {
      return res.status(400).json({ error: 'Invalid organization or home id' });
    }

    const organization = await Organization.findById(orgId).lean();
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const home = await Location.findOne({ _id: homeId, orgId: organization._id });
    if (!home) {
      return res.status(404).json({ error: 'Home not found for this organization' });
    }

    const { address } = req.body || {};
    if (address === undefined) {
      return res.status(400).json({ error: 'address is required' });
    }

    home.address = String(address).trim();
    await home.save();

    return res.json({
      home: {
        _id: home._id,
        orgId: home.orgId,
        name: home.name,
        displayName: home.displayName,
        address: home.address,
        phoneNumber: home.phoneNumber,
        maxClients: home.maxClients,
        status: home.status,
        notes: home.notes
      }
    });
  } catch (error) {
    console.error('Error updating organization home for super admin:', error);
    return res.status(500).json({ error: 'Failed to update organization home' });
  }
});

// Super admin: list active clients across one organization.
router.get('/organizations/:orgId/clients', async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orgId)) {
      return res.status(400).json({ error: 'Invalid organization id' });
    }

    const organization = await Organization.findById(orgId).lean();
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const clients = await Client.find({ orgId: organization._id, status: 'active' })
      .sort({ displayName: 1 })
      .lean();

    return res.json({
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        stateCode: organization.stateCode || null
      },
      clients
    });
  } catch (error) {
    console.error('Error listing organization clients for super admin:', error);
    return res.status(500).json({ error: 'Failed to list organization clients' });
  }
});

// Super admin: list active clients for one home under one organization.
router.get('/organizations/:orgId/homes/:homeId/clients', async (req, res) => {
  try {
    const { orgId, homeId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orgId) || !mongoose.Types.ObjectId.isValid(homeId)) {
      return res.status(400).json({ error: 'Invalid organization or home id' });
    }

    const organization = await Organization.findById(orgId).lean();
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const home = await Location.findOne({ _id: homeId, orgId: organization._id }).lean();
    if (!home) {
      return res.status(404).json({ error: 'Home not found for this organization' });
    }

    const clients = await Client.find({
      orgId: organization._id,
      locationId: home._id,
      status: 'active'
    })
      .sort({ displayName: 1 })
      .lean();

    return res.json({
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        stateCode: organization.stateCode || null
      },
      home,
      clients
    });
  } catch (error) {
    console.error('Error listing organization home clients for super admin:', error);
    return res.status(500).json({ error: 'Failed to list organization home clients' });
  }
});

// Super admin: fetch tracker entries for a specific client inside a selected organization context.
router.get('/organizations/:orgId/clients/:clientId/tracker', async (req, res) => {
  try {
    const { orgId, clientId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(orgId) || !mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({ error: 'Invalid organization or client id' });
    }

    const organization = await Organization.findById(orgId).lean();
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const client = await Client.findOne({ _id: clientId, orgId: organization._id }).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found for this organization' });
    }

    const safeLimit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const entries = await TrackerEntry.find({ orgId: organization._id, clientId: client._id })
      .select('-photo.data')
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();

    return res.json({
      organization: {
        id: organization._id,
        name: organization.name,
        slug: organization.slug,
        stateCode: organization.stateCode || null
      },
      client: {
        id: client._id,
        displayName: client.displayName,
        externalId: client.externalId || ''
      },
      entries
    });
  } catch (error) {
    console.error('Error loading org client tracker for super admin:', error);
    return res.status(500).json({ error: 'Failed to load client tracker entries' });
  }
});

module.exports = router;
