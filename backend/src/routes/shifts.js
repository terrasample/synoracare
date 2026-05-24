const express = require('express');
const Shift = require('../models/Shift');
const TrackerEntry = require('../models/TrackerEntry');
const Assignment = require('../models/Assignment');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const { canRole } = require('../config/accessControl');

const router = express.Router();

// Start a new shift
router.post('/', requireAuth, async (req, res) => {
  try {
    const { clientId, scheduledEndTime } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    // Verify user has active assignment to this client
    const now = new Date();
    const assignment = await Assignment.findOne({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
    });

    if (!assignment) {
      return res.status(403).json({ error: 'No active assignment to this client' });
    }

    // End any existing active shift
    await Shift.updateMany(
      { userId: req.user._id, status: 'active' },
      { status: 'cancelled', endedAt: now }
    );

    const shift = await Shift.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      startedAt: now,
      scheduledEndTime: scheduledEndTime ? new Date(scheduledEndTime) : null,
      status: 'active'
    });

    return res.status(201).json({ shift });
  } catch (error) {
    console.error('Failed to start shift:', error);
    return res.status(500).json({ error: 'Failed to start shift' });
  }
});

// Get active shift for current user
router.get('/active', requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findOne({
      userId: req.user._id,
      status: 'active'
    });

    if (!shift) {
      return res.json({ shift: null });
    }

    return res.json({ shift });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch active shift' });
  }
});

// Get shift details with report data
router.get('/:shiftId', requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findOne({
      _id: req.params.shiftId,
      orgId: req.user.orgId
    });

    if (!shift) return res.status(404).json({ error: 'Shift not found' });

    // Verify user can access this shift (owner or supervisor/admin)
    if (shift.userId.toString() !== req.user._id.toString() &&
        !canRole(req.user.role, 'shifts:all:read')) {
      return res.status(403).json({ error: 'No access to this shift' });
    }

    return res.json({ shift });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch shift' });
  }
});

// End shift and generate report
router.post('/:shiftId/end', requireAuth, async (req, res) => {
  try {
    const shift = await Shift.findOne({
      _id: req.params.shiftId,
      orgId: req.user.orgId
    });

    if (!shift) return res.status(404).json({ error: 'Shift not found' });
    if (shift.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Cannot end another user\'s shift' });
    }
    if (shift.status !== 'active') {
      return res.status(400).json({ error: 'Shift is not active' });
    }

    const now = new Date();
    const duration = now - shift.startedAt;

    // Get all entries logged during this shift
    const entries = await TrackerEntry.find({
      orgId: req.user.orgId,
      clientId: shift.clientId,
      createdBy: req.user._id,
      createdAt: { $gte: shift.startedAt, $lte: now }
    }).lean();

    // Calculate metrics
    const escalations = entries.filter(e => e.status === 'escalated');
    const completed = entries.filter(e => e.status === 'completed');
    const completionRate = entries.length > 0 ? (completed.length / entries.length) * 100 : 0;
    const escalationRate = entries.length > 0 ? (escalations.length / entries.length) * 100 : 0;

    // Update shift with report data
    shift.status = 'ended';
    shift.endedAt = now;
    shift.entriesLogged = entries.length;
    shift.escalationsCount = escalations.length;
    shift.photosCaptured = entries.filter(e => e.photo && e.photo.data).length;
    shift.reportGeneratedAt = now;
    shift.reportData = {
      summary: `Shift ended. ${entries.length} entries logged, ${escalations.length} escalations.`,
      entriesSnapshot: entries.map(e => ({
        entryId: e._id,
        eventType: e.eventType,
        priority: e.priority,
        summary: e.summary,
        status: e.status,
        createdAt: e.createdAt
      })),
      escalations: escalations.map(e => ({
        entryId: e._id,
        summary: e.summary,
        timestamp: e.createdAt
      })),
      totalDuration: duration,
      performanceMetrics: {
        completionRate: Math.round(completionRate),
        escalationRate: Math.round(escalationRate),
        averageResponseTime: entries.length > 0 ? Math.round(duration / entries.length) : 0
      }
    };

    await shift.save();

    return res.json({ shift, report: shift.reportData });
  } catch (error) {
    console.error('Failed to end shift:', error);
    return res.status(500).json({ error: 'Failed to end shift' });
  }
});

// List shifts (supervisor/admin view)
router.get('/', requireAuth, requirePermissions('shifts:all:read'), async (req, res) => {
  try {
    const { userId, status, limit, skip } = req.query;
    const safeLimit = Math.min(Math.max(Number(limit || 50), 1), 200);
    const safeSkip = Math.max(Number(skip || 0), 0);

    const query = { orgId: req.user.orgId };
    if (userId) query.userId = userId;
    if (status && ['active', 'ended', 'cancelled'].includes(status)) query.status = status;

    const shifts = await Shift.find(query)
      .sort({ startedAt: -1 })
      .limit(safeLimit)
      .skip(safeSkip)
      .populate('userId', 'fullName email')
      .populate('clientId', 'displayName externalId')
      .lean();

    const total = await Shift.countDocuments(query);

    return res.json({ shifts, total });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list shifts' });
  }
});

// Get shift summary for dashboard (real-time status)
router.get('/summary/today', requireAuth, requirePermissions('shifts:all:read'), async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const activeShifts = await Shift.find({
      orgId: req.user.orgId,
      status: 'active',
      startedAt: { $gte: today, $lt: tomorrow }
    })
      .populate('userId', 'fullName')
      .populate('clientId', 'displayName')
      .lean();

    const endedShifts = await Shift.countDocuments({
      orgId: req.user.orgId,
      status: 'ended',
      endedAt: { $gte: today, $lt: tomorrow }
    });

    const totalEntries = await TrackerEntry.countDocuments({
      orgId: req.user.orgId,
      createdAt: { $gte: today, $lt: tomorrow }
    });

    const escalations = await TrackerEntry.countDocuments({
      orgId: req.user.orgId,
      status: 'escalated',
      createdAt: { $gte: today, $lt: tomorrow }
    });

    return res.json({
      activeCount: activeShifts.length,
      endedCount: endedShifts,
      totalEntries,
      escalations,
      activeShifts
    });
  } catch (error) {
    console.error('Failed to get shift summary:', error);
    return res.status(500).json({ error: 'Failed to get shift summary' });
  }
});

module.exports = router;
