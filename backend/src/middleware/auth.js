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
  try {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = verifyWithKnownSecrets(token);
    const user = await User.findById(decoded.userId).lean();
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
}

module.exports = { requireAuth };
