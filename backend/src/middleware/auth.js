const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');

function verifyWithKnownSecrets(token) {
  const rawSecret = String(process.env.JWT_SECRET || '');
  const candidates = [env.jwtSecret, rawSecret, rawSecret.trim()]
    .map((secret) => String(secret || ''))
    .filter(Boolean);

  const uniqueSecrets = [...new Set(candidates)];
  let lastError = null;

  for (const secret of uniqueSecrets) {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Invalid token');
}

async function requireAuth(req, res, next) {
  const requestPath = String(req.originalUrl || req.url || 'unknown');
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      console.warn(`[auth] missing_token path=${requestPath}`);
      res.set('x-auth-reason', 'missing_token');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const decoded = verifyWithKnownSecrets(token);
    if (!decoded || !decoded.userId) {
      console.warn(`[auth] invalid_payload path=${requestPath}`);
      res.set('x-auth-reason', 'invalid_payload');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = await User.findById(decoded.userId).lean();
    if (user && user.status !== 'active') {
      console.warn(`[auth] user_inactive path=${requestPath} userId=${decoded.userId}`);
      res.set('x-auth-reason', 'user_inactive');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (user) {
      req.user = user;
      return next();
    }

    // Fallback for transient user lookup issues: trust signed JWT claims.
    req.user = {
      _id: decoded.userId,
      orgId: decoded.orgId,
      role: decoded.role,
      status: 'active'
    };
    console.warn(`[auth] user_lookup_fallback path=${requestPath} userId=${decoded.userId}`);
    return next();
  } catch (err) {
    console.warn(`[auth] verify_failed path=${requestPath} reason=${err?.name || 'unknown'}`);
    res.set('x-auth-reason', `verify_failed:${err?.name || 'unknown'}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
