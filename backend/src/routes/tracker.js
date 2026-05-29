const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const Assignment = require('../models/Assignment');
const Client = require('../models/Client');
const TrackerEntry = require('../models/TrackerEntry');
const AuditEvent = require('../models/AuditEvent');
const { canRole } = require('../config/accessControl');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (String(file.mimetype || '').startsWith('image/')) {
      cb(null, true);
      return;
    }

    cb(new Error('Only image files are allowed for tracker photos'));
  }
});

async function getAccessibleClientIds(user) {
  if (user.role === 'supervisor') {
    const locationIds = Array.isArray(user.locationIds) ? user.locationIds : [];
    if (!locationIds.length) return [];

    const clients = await Client.find({
      orgId: user.orgId,
      locationId: { $in: locationIds },
      status: 'active'
    }).select('_id').lean();

    return clients.map((c) => String(c._id));
  }

  if (canRole(user.role, 'clients:all:read')) {
    const clients = await Client.find({ orgId: user.orgId, status: 'active' }).select('_id').lean();
    return clients.map((c) => String(c._id));
  }

  const now = new Date();
  const assignments = await Assignment.find({
    orgId: user.orgId,
    userId: user._id,
    startsAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  })
    .select('clientId')
    .lean();

  return assignments.map((a) => String(a.clientId));
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const { clientId, status, limit, from, to } = req.query;
    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.length) return res.json({ entries: [] });

    const query = {
      orgId: req.user.orgId,
      clientId: { $in: accessibleClientIds }
    };

    if (clientId) {
      if (!accessibleClientIds.includes(String(clientId))) {
        return res.status(403).json({ error: 'No access to this client' });
      }
      query.clientId = clientId;
    }

    if (status && ['pending', 'completed', 'escalated'].includes(String(status))) {
      query.status = String(status);
    }

    if (from || to) {
      const createdAt = {};
      if (from) {
        const fromDate = new Date(`${String(from)}T00:00:00.000Z`);
        if (!Number.isNaN(fromDate.getTime())) {
          createdAt.$gte = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(`${String(to)}T23:59:59.999Z`);
        if (!Number.isNaN(toDate.getTime())) {
          createdAt.$lte = toDate;
        }
      }
      if (createdAt.$gte || createdAt.$lte) {
        query.createdAt = createdAt;
      }
    }

    const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
    const entries = await TrackerEntry.find(query)
      .select('-photo.data')
      .sort({ createdAt: -1 })
      .limit(safeLimit)
      .lean();

    return res.json({ entries });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load tracker entries' });
  }
});

router.get('/summary', requireAuth, async (req, res) => {
  try {
    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.length) {
      return res.json({
        pending: 0,
        completed: 0,
        escalated: 0,
        overdue: 0,
        total: 0,
        counts: { pending: 0, completed: 0, escalated: 0, overdue: 0, total: 0 }
      });
    }

    const baseQuery = { orgId: req.user.orgId, clientId: { $in: accessibleClientIds } };
    const now = new Date();

    const [pending, completed, escalated, overdue, total] = await Promise.all([
      TrackerEntry.countDocuments({ ...baseQuery, status: 'pending' }),
      TrackerEntry.countDocuments({ ...baseQuery, status: 'completed' }),
      TrackerEntry.countDocuments({ ...baseQuery, status: 'escalated' }),
      TrackerEntry.countDocuments({ ...baseQuery, status: 'pending', dueAt: { $ne: null, $lt: now } }),
      TrackerEntry.countDocuments(baseQuery)
    ]);

    return res.json({
      pending,
      completed,
      escalated,
      overdue,
      total,
      counts: { pending, completed, escalated, overdue, total }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load tracker summary' });
  }
});

router.post('/', requireAuth, upload.single('photo'), async (req, res) => {
  try {
    const { clientId, eventType, priority, status, summary, details, dueAt, photoCaption } = req.body || {};
    if (!clientId || !eventType || !summary) {
      return res.status(400).json({ error: 'clientId, eventType, summary required' });
    }

    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.includes(String(clientId))) {
      return res.status(403).json({ error: 'No access to this client' });
    }

    const photo = req.file
      ? {
          fileName: req.file.originalname,
          contentType: req.file.mimetype,
          size: req.file.size,
          data: req.file.buffer,
          capturedAt: new Date()
        }
      : null;

    const entry = await TrackerEntry.create({
      orgId: req.user.orgId,
      clientId,
      createdBy: req.user._id,
      eventType,
      priority: priority || 'normal',
      status: status || 'pending',
      summary,
      details: details || '',
      photo,
      photoCaption: photoCaption || '',
      dueAt: dueAt ? new Date(dueAt) : null,
      completedAt: status === 'completed' ? new Date() : null,
      completedBy: status === 'completed' ? req.user._id : null
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'tracker_entry',
      payload: {
        trackerId: String(entry._id),
        eventType,
        priority: entry.priority,
        status: entry.status,
        hasPhoto: Boolean(photo)
      }
    });

    const payload = entry.toObject();
    if (payload.photo) {
      payload.photo.data = undefined;
    }

    return res.status(201).json({ entry: payload });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create tracker entry' });
  }
});

router.get('/:id/photo', requireAuth, async (req, res) => {
  try {
    const entry = await TrackerEntry.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!entry) return res.status(404).json({ error: 'Tracker entry not found' });

    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.includes(String(entry.clientId))) {
      return res.status(403).json({ error: 'No access to this client' });
    }

    if (!entry.photo || !entry.photo.data || !entry.photo.contentType) {
      return res.status(404).json({ error: 'No photo attached to this tracker entry' });
    }

    res.setHeader('Content-Type', entry.photo.contentType);
    res.setHeader('Content-Length', entry.photo.size || entry.photo.data.length);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(entry.photo.data);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load tracker photo' });
  }
});

router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pending', 'completed', 'escalated'].includes(String(status || ''))) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'Invalid entry ID' });
    }

    const entry = await TrackerEntry.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!entry) return res.status(404).json({ error: 'Tracker entry not found' });

    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.includes(String(entry.clientId))) {
      return res.status(403).json({ error: 'No access to this client' });
    }

    entry.status = status;
    if (status === 'completed') {
      entry.completedAt = new Date();
      entry.completedBy = req.user._id;
    } else {
      entry.completedAt = null;
      entry.completedBy = null;
    }

    await entry.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: entry.clientId,
      eventType: 'tracker_status_update',
      payload: {
        trackerId: String(entry._id),
        status
      }
    });

    return res.json({ entry });
  } catch (error) {
    console.error('[tracker] PATCH /:id/status error:', error);
    return res.status(500).json({ error: 'Failed to update tracker status' });
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const entry = await TrackerEntry.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!entry) return res.status(404).json({ error: 'Tracker entry not found' });

    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.includes(String(entry.clientId))) {
      return res.status(403).json({ error: 'No access to this client' });
    }

    const entryId = String(entry._id);
    await TrackerEntry.deleteOne({ _id: entry._id, orgId: req.user.orgId });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId: entry.clientId,
      eventType: 'tracker_entry',
      payload: {
        action: 'deleted',
        trackerId: entryId
      }
    });

    return res.json({ ok: true, id: entryId });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete tracker entry' });
  }
});

module.exports = router;
