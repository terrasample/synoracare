const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Organization = require('../models/Organization');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');
const env = require('../config/env');

const router = express.Router();

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

    return res.json({ token, user: { id: user._id, fullName: user.fullName, role: user.role, orgId: user.orgId } });
  } catch (error) {
    return res.status(500).json({ error: 'Bootstrap failed', detail: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    await AuditEvent.create({ orgId: user.orgId, userId: user._id, eventType: 'login', payload: {} });

    return res.json({
      token,
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        orgId: user.orgId
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Login failed', detail: error.message });
  }
});

module.exports = router;
