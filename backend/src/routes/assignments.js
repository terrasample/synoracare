const express = require('express');
const Assignment = require('../models/Assignment');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

router.get('/', requireAuth, requireRoles('super_admin', 'org_admin', 'supervisor'), async (req, res) => {
  try {
    const assignments = await Assignment.find({ orgId: req.user.orgId }).lean();
    return res.json({ assignments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list assignments' });
  }
});

router.get('/users', requireAuth, requireRoles('super_admin', 'org_admin', 'supervisor'), async (req, res) => {
  try {
    const users = await User.find({ orgId: req.user.orgId, status: 'active' })
      .select('_id fullName email role')
      .sort({ fullName: 1 })
      .lean();
    return res.json({ users });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

router.post('/', requireAuth, requireRoles('super_admin', 'org_admin', 'supervisor'), async (req, res) => {
  try {
    const { userId, clientId, expiresAt } = req.body || {};
    if (!userId || !clientId) return res.status(400).json({ error: 'userId and clientId are required' });

    let expiresAtValue = null;
    if (expiresAt) {
      const parsedDate = new Date(expiresAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return res.status(400).json({ error: 'Invalid expiresAt' });
      }
      expiresAtValue = parsedDate;
    }

    const assignment = await Assignment.findOneAndUpdate(
      { orgId: req.user.orgId, userId, clientId },
      {
        orgId: req.user.orgId,
        userId,
        clientId,
        assignedBy: req.user._id,
        startsAt: new Date(),
        expiresAt: expiresAtValue,
        isBreakGlass: false,
        breakGlassReason: ''
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(201).json({ assignment });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create assignment' });
  }
});

router.post('/break-glass', requireAuth, async (req, res) => {
  try {
    const { clientId, reason, durationMinutes, userId } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!reason || String(reason).trim().length < 12) {
      return res.status(400).json({ error: 'Break-glass reason (minimum 12 chars) is required' });
    }

    const duration = Math.max(5, Math.min(Number(durationMinutes || 30), 240));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + duration * 60 * 1000);

    const targetUserId = ['super_admin', 'org_admin', 'supervisor'].includes(req.user.role)
      ? (userId || req.user._id)
      : req.user._id;

    const assignment = await Assignment.findOneAndUpdate(
      {
        orgId: req.user.orgId,
        userId: targetUserId,
        clientId
      },
      {
        orgId: req.user.orgId,
        userId: targetUserId,
        clientId,
        assignedBy: req.user._id,
        startsAt: now,
        expiresAt,
        isBreakGlass: true,
        breakGlassReason: String(reason).trim()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'break_glass_created',
      payload: {
        targetUserId: String(targetUserId),
        durationMinutes: duration,
        expiresAt,
        reason: String(reason).trim()
      }
    });

    return res.status(201).json({ assignment });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create break-glass access' });
  }
});

router.post('/users', requireAuth, requireRoles('super_admin', 'org_admin'), async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body || {};
    if (!fullName || !email || !password || !role) {
      return res.status(400).json({ error: 'fullName, email, password, role required' });
    }

    if (!['org_admin', 'supervisor', 'dsp'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const bcrypt = require('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      orgId: req.user.orgId,
      fullName,
      email: String(email).toLowerCase(),
      passwordHash,
      role
    });

    return res.status(201).json({ user: { id: user._id, fullName: user.fullName, email: user.email, role: user.role } });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/users/:id/reset-password', requireAuth, requireRoles('super_admin', 'org_admin'), async (req, res) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'newPassword must be at least 8 characters' });
    }

    const user = await User.findOne({ _id: req.params.id, orgId: req.user.orgId });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const bcrypt = require('bcryptjs');
    user.passwordHash = await bcrypt.hash(String(newPassword), 10);
    await user.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'password_reset',
      payload: { targetUserId: String(user._id), targetEmail: user.email }
    });

    return res.json({ user: { id: user._id, fullName: user.fullName, email: user.email } });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;
