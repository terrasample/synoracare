const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Assignment = require('../models/Assignment');
const User = require('../models/User');
const Client = require('../models/Client');
const InviteToken = require('../models/InviteToken');
const AuditEvent = require('../models/AuditEvent');
const Organization = require('../models/Organization');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const { getRoleDisplayLabel, mergeRoleDisplayLabels, canRole } = require('../config/accessControl');

const router = express.Router();

function userCanAccessClientByHome(user, client) {
  const locationIds = Array.isArray(user?.locationIds) ? user.locationIds : [];
  if (!locationIds.length || !client?.locationId) return false;
  return locationIds.some((locationId) => String(locationId) === String(client.locationId));
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function buildInviteUrl(token, email) {
  const base = String(process.env.FRONTEND_BASE_URL || '').replace(/\/$/, '');
  const query = `inviteToken=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  if (!base) return `/index.html?${query}`;
  return `${base}/index.html?${query}`;
}

async function getOrgRoleDisplayLabels(orgId) {
  const org = await Organization.findById(orgId).select('roleDisplayLabels').lean();
  return mergeRoleDisplayLabels(org?.roleDisplayLabels || {});
}

router.get('/', requireAuth, requirePermissions('assignments:read'), async (req, res) => {
  try {
    const assignments = await Assignment.find({ orgId: req.user.orgId }).lean();
    return res.json({ assignments });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list assignments' });
  }
});

router.get('/users', requireAuth, requirePermissions('users:read'), async (req, res) => {
  try {
    const roleDisplayLabels = await getOrgRoleDisplayLabels(req.user.orgId);
    const users = await User.find({ orgId: req.user.orgId })
      .select('_id fullName email role status inviteAcceptedAt')
      .sort({ fullName: 1 })
      .lean();
    return res.json({
      users: users.map((user) => ({
        ...user,
        roleDisplayName: getRoleDisplayLabel(user.role, roleDisplayLabels)
      }))
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

router.post('/', requireAuth, requirePermissions('assignments:create'), async (req, res) => {
  try {
    const { userId, clientId, expiresAt } = req.body || {};
    if (!userId || !clientId) return res.status(400).json({ error: 'userId and clientId are required' });

    const { isValidObjectId } = mongoose;
    if (!isValidObjectId(userId)) return res.status(400).json({ error: 'Invalid userId' });
    if (!isValidObjectId(clientId)) return res.status(400).json({ error: 'Invalid clientId' });

    const [targetUser, client] = await Promise.all([
      User.findOne({ _id: userId, orgId: req.user.orgId }).lean(),
      Client.findOne({ _id: clientId, orgId: req.user.orgId }).lean()
    ]);

    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (req.user.role === 'supervisor' && !userCanAccessClientByHome(req.user, client)) {
      return res.status(403).json({ error: 'Supervisors can only assign clients within their homes' });
    }

    if (targetUser.role === 'supervisor' && !userCanAccessClientByHome(targetUser, client)) {
      return res.status(400).json({ error: 'Target supervisor is not assigned to this client home' });
    }

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
    console.error('[assignments] POST / error:', error);
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

    const targetUserId = canRole(req.user.role, 'assignments:create')
      ? (userId || req.user._id)
      : req.user._id;

    const [targetUser, client] = await Promise.all([
      User.findOne({ _id: targetUserId, orgId: req.user.orgId }).lean(),
      Client.findOne({ _id: clientId, orgId: req.user.orgId }).lean()
    ]);

    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
    if (!client) return res.status(404).json({ error: 'Client not found' });

    if (req.user.role === 'supervisor' && !userCanAccessClientByHome(req.user, client)) {
      return res.status(403).json({ error: 'Supervisors can only create break-glass for clients within their homes' });
    }

    if (targetUser.role === 'supervisor' && !userCanAccessClientByHome(targetUser, client)) {
      return res.status(400).json({ error: 'Target supervisor is not assigned to this client home' });
    }

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

router.post('/users', requireAuth, requirePermissions('users:invite'), async (req, res) => {
  try {
    const { fullName, email, role } = req.body || {};
    if (!fullName || !email || !role) {
      return res.status(400).json({ error: 'fullName, email, and role are required' });
    }

    if (!['org_admin', 'supervisor', 'dsp'].includes(role)) {
      return res.status(400).json({ error: 'invalid role' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await User.findOne({ orgId: req.user.orgId, email: normalizedEmail });
    if (user && user.status === 'active') {
      return res.status(409).json({ error: 'User already has an active account' });
    }

    const placeholderPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);

    if (user) {
      user.fullName = String(fullName).trim();
      user.role = role;
      user.status = 'inactive';
      user.passwordHash = passwordHash;
      user.inviteAcceptedAt = null;
      user.termsAcceptedAt = null;
      await user.save();
    } else {
      user = await User.create({
        orgId: req.user.orgId,
        fullName: String(fullName).trim(),
        email: normalizedEmail,
        passwordHash,
        role,
        status: 'inactive'
      });
    }

    const rawInviteToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(rawInviteToken);
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await InviteToken.deleteMany({ userId: user._id });
    await InviteToken.create({
      orgId: req.user.orgId,
      userId: user._id,
      invitedBy: req.user._id,
      email: normalizedEmail,
      role,
      tokenHash,
      expiresAt
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: { action: 'team_invite_created', targetUserId: String(user._id), targetEmail: normalizedEmail }
    });

    const roleDisplayLabels = await getOrgRoleDisplayLabels(req.user.orgId);

    return res.status(201).json({
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        roleDisplayName: getRoleDisplayLabel(user.role, roleDisplayLabels),
        status: user.status
      },
      inviteToken: rawInviteToken,
      inviteLink: buildInviteUrl(rawInviteToken, normalizedEmail),
      expiresInHours: 72
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/users/:id/reset-password', requireAuth, requirePermissions('users:password_reset'), async (req, res) => {
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
