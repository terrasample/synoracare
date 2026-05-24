const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');
const User = require('../models/User');
const InviteToken = require('../models/InviteToken');
const RecoveryToken = require('../models/RecoveryToken');
const AuditEvent = require('../models/AuditEvent');
const { createRateLimiter } = require('../middleware/rateLimit');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const {
  SYSTEM_ROLES,
  getPermissionsForRole,
  sanitizeRoleDisplayLabels,
  mergeRoleDisplayLabels,
  getRoleDisplayLabel
} = require('../config/accessControl');
const env = require('../config/env');

const router = express.Router();

const loginLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 12,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many login attempts. Try again later.'
});

const forgotRequestLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
  message: 'Too many reset requests. Try again later.'
});

const tokenConsumeLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.ip,
  message: 'Too many attempts. Try again later.'
});

function signToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      orgId: String(user.orgId),
      role: user.role
    },
    env.jwtSecret,
    { expiresIn: '12h' }
  );
}

async function ensureRecoveryOrganization() {
  const existingOrg = await Organization.findOne({}).sort({ createdAt: 1 });
  if (existingOrg) return existingOrg;

  return Organization.create({
    name: 'Recovered Organization',
    slug: `recovered-org-${Date.now().toString(36)}`,
    stateCode: ''
  });
}

function hashRecoveryToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isAdminRole(role) {
  return role === 'org_admin' || role === 'super_admin';
}

function validatePassword(password) {
  const raw = String(password || '');
  if (raw.length < 10) {
    return 'Password must be at least 10 characters.';
  }

  const hasUpper = /[A-Z]/.test(raw);
  const hasLower = /[a-z]/.test(raw);
  const hasNumber = /\d/.test(raw);
  const hasSpecial = /[^A-Za-z0-9]/.test(raw);

  if (!(hasUpper && hasLower && hasNumber && hasSpecial)) {
    return 'Password must include uppercase, lowercase, number, and special character.';
  }

  return '';
}

function buildFrontendUrl(path, query) {
  const base = String(env.frontendBaseUrl || '').replace(/\/$/, '');
  const queryText = query ? `?${query}` : '';
  if (!base) return `${path}${queryText}`;
  return `${base}${path}${queryText}`;
}

async function getOrganizationRoleLabels(orgId) {
  if (!orgId) return mergeRoleDisplayLabels({});

  const org = await Organization.findById(orgId)
    .select('roleDisplayLabels')
    .lean();

  return mergeRoleDisplayLabels(org?.roleDisplayLabels || {});
}

async function buildAuthUserPayload(user) {
  const roleDisplayLabels = await getOrganizationRoleLabels(user.orgId);
  return {
    id: user._id,
    fullName: user.fullName,
    role: user.role,
    roleDisplayName: getRoleDisplayLabel(user.role, roleDisplayLabels),
    roleDisplayLabels,
    permissions: getPermissionsForRole(user.role),
    orgId: user.orgId,
    email: user.email
  };
}

router.post('/bootstrap', async (req, res) => {
  try {
    const count = await User.countDocuments({});
    if (count > 0) {
      return res.status(409).json({ error: 'Bootstrap already completed' });
    }

    const { orgName, orgSlug, orgStateCode, fullName, email, password } = req.body || {};
    if (!orgName || !orgSlug || !fullName || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const org = await Organization.create({
      name: orgName,
      slug: orgSlug.toLowerCase(),
      stateCode: String(orgStateCode || '').trim().toUpperCase()
    });
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      orgId: org._id,
      fullName,
      email: String(email).toLowerCase(),
      passwordHash,
      role: 'super_admin'
    });

    const token = signToken(user);
    await AuditEvent.create({
      orgId: org._id,
      userId: user._id,
      eventType: 'login',
      payload: { action: 'bootstrap' }
    });

    return res.json({ token, user: await buildAuthUserPayload(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Bootstrap failed' });
  }
});

router.post('/login', async (req, res) => {
  return loginLimiter(req, res, async () => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    if (user.status !== 'active') {
      return res.status(403).json({
        error: `Account is inactive. Contact your organization administrator or ${env.supportEmail}.`
      });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    if (env.requireAdminMfa && isAdminRole(user.role) && !user.mfaEnabled) {
      return res.status(403).json({
        error: 'Admin MFA is required for this organization. Please contact support to enable your MFA enrollment.'
      });
    }

    const token = signToken(user);
    await AuditEvent.create({ orgId: user.orgId, userId: user._id, eventType: 'login', payload: {} });

    return res.json({ token, user: await buildAuthUserPayload(user) });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed' });
  }
  });
});

router.get('/permissions', requireAuth, async (req, res) => {
  try {
    const roleDisplayLabels = await getOrganizationRoleLabels(req.user.orgId);
    const permissions = getPermissionsForRole(req.user.role);

    return res.json({
      role: req.user.role,
      roleDisplayName: getRoleDisplayLabel(req.user.role, roleDisplayLabels),
      roleDisplayLabels,
      permissions,
      supportedRoles: SYSTEM_ROLES
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load permissions' });
  }
});

router.patch('/role-labels', requireAuth, requireRoles('super_admin', 'org_admin'), async (req, res) => {
  try {
    const incoming = req.body?.roleDisplayLabels;
    const sanitized = sanitizeRoleDisplayLabels(incoming);

    const org = await Organization.findByIdAndUpdate(
      req.user.orgId,
      { $set: { roleDisplayLabels: sanitized } },
      { new: true }
    )
      .select('roleDisplayLabels')
      .lean();

    const roleDisplayLabels = mergeRoleDisplayLabels(org?.roleDisplayLabels || {});

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'role_labels_updated',
        updatedRoles: Object.keys(sanitized)
      }
    });

    return res.json({
      ok: true,
      roleDisplayLabels
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to update role labels' });
  }
});

router.post('/forgot-password/request', async (req, res) => {
  return forgotRequestLimiter(req, res, async () => {
    try {
      const { email } = req.body || {};
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail) {
        return res.status(400).json({ error: 'email required' });
      }

      const user = await User.findOne({ email: normalizedEmail, status: 'active' });
      if (!user) {
        return res.json({
          ok: true,
          message: 'If an account exists, a password reset link/token has been issued.'
        });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashRecoveryToken(resetToken);
      const expiresAt = new Date(Date.now() + 20 * 60 * 1000);

      await RecoveryToken.deleteMany({ email: normalizedEmail, purpose: 'password_reset' });
      await RecoveryToken.create({
        orgId: user.orgId,
        userId: user._id,
        email: normalizedEmail,
        fullName: user.fullName,
        purpose: 'password_reset',
        tokenHash,
        expiresAt
      });

      await AuditEvent.create({
        orgId: user.orgId,
        userId: user._id,
        eventType: 'security_alert',
        payload: { action: 'forgot_password_requested' }
      });

      return res.json({
        ok: true,
        message: 'If an account exists, a password reset link/token has been issued.',
        resetToken,
        resetUrl: buildFrontendUrl('/index.html', `resetToken=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(normalizedEmail)}`),
        expiresInMinutes: 20
      });
    } catch (error) {
      return res.status(500).json({ error: 'Password reset request failed' });
    }
  });
});

router.post('/forgot-password/complete', async (req, res) => {
  return tokenConsumeLimiter(req, res, async () => {
    try {
      const { email, resetToken, newPassword } = req.body || {};
      const normalizedEmail = String(email || '').trim().toLowerCase();
      if (!normalizedEmail || !resetToken || !newPassword) {
        return res.status(400).json({ error: 'email, resetToken, and newPassword are required' });
      }

      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      const tokenHash = hashRecoveryToken(resetToken);
      const recoveryToken = await RecoveryToken.findOneAndUpdate(
        {
          email: normalizedEmail,
          purpose: 'password_reset',
          tokenHash,
          usedAt: null,
          expiresAt: { $gt: new Date() }
        },
        { $set: { usedAt: new Date() } },
        { new: true }
      );

      if (!recoveryToken) {
        return res.status(403).json({ error: 'Invalid or expired reset token' });
      }

      const user = await User.findOne({ _id: recoveryToken.userId, email: normalizedEmail });
      if (!user) {
        return res.status(404).json({ error: 'Account not found' });
      }

      user.passwordHash = await bcrypt.hash(String(newPassword), 10);
      await user.save();

      await AuditEvent.create({
        orgId: user.orgId,
        userId: user._id,
        eventType: 'password_reset',
        payload: { action: 'forgot_password_complete' }
      });

      await RecoveryToken.deleteMany({ _id: recoveryToken._id });

      return res.json({ ok: true, message: 'Password updated successfully.' });
    } catch (error) {
      return res.status(500).json({ error: 'Password reset failed' });
    }
  });
});

router.post('/recover-account/request', async (req, res) => {
  return tokenConsumeLimiter(req, res, async () => {
  try {
    if (!env.accountRecoveryEnabled) {
      return res.status(503).json({ error: 'Account recovery is disabled' });
    }

    const configuredRecoveryKey = String(env.accountRecoveryKey || '').trim();
    if (!configuredRecoveryKey) {
      return res.status(503).json({ error: 'Account recovery is disabled' });
    }

    const { recoveryKey, email, fullName } = req.body || {};
    if (!recoveryKey || String(recoveryKey) !== configuredRecoveryKey) {
      return res.status(403).json({ error: 'Invalid recovery key' });
    }

    if (!email) {
      return res.status(400).json({ error: 'email required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashRecoveryToken(resetToken);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await RecoveryToken.deleteMany({ email: normalizedEmail, purpose: 'admin_recovery' });
    await RecoveryToken.create({
      email: normalizedEmail,
      fullName: String(fullName || '').trim(),
      purpose: 'admin_recovery',
      tokenHash,
      expiresAt
    });

    return res.json({
      ok: true,
      email: normalizedEmail,
      resetToken,
      expiresInMinutes: 15
    });
  } catch (error) {
    return res.status(500).json({ error: 'Account recovery failed' });
  }
  });
});

router.post('/recover-account', async (req, res) => {
  return tokenConsumeLimiter(req, res, async () => {
  try {
    if (!env.accountRecoveryEnabled) {
      return res.status(503).json({ error: 'Account recovery is disabled' });
    }

    const { resetToken, email, newPassword, fullName } = req.body || {};
    if (!resetToken || !email || !newPassword) {
      return res.status(400).json({ error: 'resetToken, email, and newPassword are required' });
    }

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const tokenHash = hashRecoveryToken(resetToken);

    const recoveryToken = await RecoveryToken.findOneAndUpdate(
      {
        email: normalizedEmail,
        purpose: 'admin_recovery',
        tokenHash,
        usedAt: null,
        expiresAt: { $gt: new Date() }
      },
      { $set: { usedAt: new Date() } },
      { new: true }
    );

    if (!recoveryToken) {
      return res.status(403).json({ error: 'Invalid or expired recovery token' });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);

    let user = await User.findOne({ email: normalizedEmail });
    let action = 'password_reset';

    if (user) {
      const updateFields = {
        passwordHash,
        status: 'active'
      };

      if (!user.orgId) {
        const org = await ensureRecoveryOrganization();
        updateFields.orgId = org._id;
      }
      if (fullName && String(fullName).trim()) {
        updateFields.fullName = String(fullName).trim();
      } else if (!user.fullName || !String(user.fullName).trim()) {
        updateFields.fullName = String(normalizedEmail.split('@')[0] || 'Recovered User').trim();
      }
      if (!user.role) {
        updateFields.role = 'super_admin';
      }

      await User.updateOne({ _id: user._id }, { $set: updateFields });
      user = await User.findById(user._id);
    } else {
      const org = await ensureRecoveryOrganization();

      user = await User.create({
        orgId: org._id,
        fullName: String(fullName || 'Recovered Admin').trim(),
        email: normalizedEmail,
        passwordHash,
        role: 'super_admin',
        status: 'active'
      });
      action = 'created_super_admin';
    }

    await AuditEvent.create({
      orgId: user.orgId,
      userId: user._id,
      eventType: 'password_reset',
      payload: { action: 'recovery', result: action }
    });

    await RecoveryToken.deleteMany({ _id: recoveryToken._id });

    const token = signToken(user);
    return res.json({
      ok: true,
      action,
      token,
      user: await buildAuthUserPayload(user)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Account recovery failed' });
  }
  });
});

router.post('/accept-invite', async (req, res) => {
  return tokenConsumeLimiter(req, res, async () => {
    try {
      const { inviteToken, fullName, password, acceptTerms } = req.body || {};
      if (!inviteToken || !password || !acceptTerms) {
        return res.status(400).json({ error: 'inviteToken, password, and acceptTerms are required' });
      }

      const passwordError = validatePassword(password);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }

      const tokenHash = hashRecoveryToken(inviteToken);
      const invite = await InviteToken.findOneAndUpdate(
        {
          tokenHash,
          usedAt: null,
          expiresAt: { $gt: new Date() }
        },
        { $set: { usedAt: new Date() } },
        { new: true }
      );

      if (!invite) {
        return res.status(403).json({ error: 'Invalid or expired invite token' });
      }

      const user = await User.findOne({ _id: invite.userId, orgId: invite.orgId, email: invite.email });
      if (!user) {
        return res.status(404).json({ error: 'Invited account not found' });
      }

      user.passwordHash = await bcrypt.hash(String(password), 10);
      user.status = 'active';
      user.fullName = String(fullName || user.fullName).trim() || user.fullName;
      user.inviteAcceptedAt = new Date();
      user.termsAcceptedAt = new Date();
      await user.save();

      await InviteToken.deleteMany({ userId: user._id });

      await AuditEvent.create({
        orgId: user.orgId,
        userId: user._id,
        eventType: 'security_alert',
        payload: { action: 'invite_accepted' }
      });

      const token = signToken(user);
      return res.json({
        ok: true,
        token,
        user: await buildAuthUserPayload(user)
      });
    } catch (error) {
      return res.status(500).json({ error: 'Invite acceptance failed' });
    }
  });
});

router.post('/org-activation/request', async (req, res) => {
  try {
    const activationKey = String(req.body?.activationKey || '');
    if (!env.orgActivationKey || activationKey !== env.orgActivationKey) {
      return res.status(403).json({ error: 'Invalid activation key' });
    }

    const { orgName, orgSlug, orgStateCode, adminName, adminEmail } = req.body || {};
    if (!orgName || !orgSlug || !adminName || !adminEmail) {
      return res.status(400).json({ error: 'orgName, orgSlug, adminName, and adminEmail are required' });
    }

    const normalizedEmail = String(adminEmail).trim().toLowerCase();
    const slug = String(orgSlug).trim().toLowerCase();

    const existingOrg = await Organization.findOne({ slug });
    if (existingOrg) {
      return res.status(409).json({ error: 'Organization slug already exists' });
    }

    const org = await Organization.create({
      name: String(orgName).trim(),
      slug,
      stateCode: String(orgStateCode || '').trim().toUpperCase()
    });

    const placeholderPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);
    const adminUser = await User.create({
      orgId: org._id,
      fullName: String(adminName).trim(),
      email: normalizedEmail,
      passwordHash,
      role: 'org_admin',
      status: 'inactive'
    });

    const rawInviteToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashRecoveryToken(rawInviteToken);
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    await InviteToken.create({
      orgId: org._id,
      userId: adminUser._id,
      invitedBy: adminUser._id,
      email: normalizedEmail,
      role: 'org_admin',
      tokenHash,
      expiresAt
    });

    return res.status(201).json({
      ok: true,
      organization: { id: org._id, name: org.name, slug: org.slug },
      inviteToken: rawInviteToken,
      inviteUrl: buildFrontendUrl('/index.html', `inviteToken=${encodeURIComponent(rawInviteToken)}&email=${encodeURIComponent(normalizedEmail)}`),
      expiresInHours: 48
    });
  } catch (error) {
    return res.status(500).json({ error: 'Organization activation failed' });
  }
});

module.exports = router;
