const express = require('express');
const crypto = require('crypto');
const DemoRequest = require('../models/DemoRequest');

const router = express.Router();
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const IP_LIMIT_PER_WINDOW = 5;
const EMAIL_LIMIT_PER_WINDOW = 3;
const FINGERPRINT_LIMIT_PER_WINDOW = 4;

function normalizeUserAgent(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 180);
}

function buildFingerprint(ipAddress, email, userAgent) {
  return crypto
    .createHash('sha256')
    .update(`${ipAddress}|${String(email || '').trim().toLowerCase()}|${normalizeUserAgent(userAgent)}`)
    .digest('hex');
}

async function getRateLimitReason(ipAddress, email, fingerprint) {
  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS);
  const [ipCount, emailCount, fingerprintCount] = await Promise.all([
    DemoRequest.countDocuments({ 'metadata.ip': ipAddress, createdAt: { $gte: windowStart } }),
    DemoRequest.countDocuments({ email, createdAt: { $gte: windowStart } }),
    DemoRequest.countDocuments({ 'metadata.fingerprint': fingerprint, createdAt: { $gte: windowStart } })
  ]);

  if (ipCount >= IP_LIMIT_PER_WINDOW) return 'ip';
  if (emailCount >= EMAIL_LIMIT_PER_WINDOW) return 'email';
  if (fingerprintCount >= FINGERPRINT_LIMIT_PER_WINDOW) return 'fingerprint';
  return '';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// POST demo request
router.post('/demo-request', async (req, res) => {
  try {
    const organizationName = String(req.body.organizationName || req.body.orgName || '').trim();
    const contactName = String(req.body.contactName || '').trim();
    const email = String(req.body.email || req.body.contactEmail || '').trim().toLowerCase();
    const phone = String(req.body.phone || req.body.contactPhone || '').trim();
    const message = String(req.body.message || '').trim();
    const requestType = String(req.body.requestType || 'demo').trim().toLowerCase();
    const source = String(req.body.source || 'web').trim().toLowerCase();
    const ipAddress = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const userAgent = String(req.headers['user-agent'] || '');

    // Validate required fields
    if (!organizationName || !contactName || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const fingerprint = buildFingerprint(ipAddress, email, userAgent);
    const rateLimitReason = await getRateLimitReason(ipAddress, email, fingerprint);
    if (rateLimitReason) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    const allowedTypes = new Set(['demo', 'pilot', 'walkthrough']);
    const normalizedType = allowedTypes.has(requestType) ? requestType : 'demo';

    const record = await DemoRequest.create({
      organizationName,
      contactName,
      email,
      phone,
      requestType: normalizedType,
      message,
      source,
      metadata: {
        ip: ipAddress,
        userAgent: normalizeUserAgent(userAgent),
        fingerprint
      }
    });

    console.log('Demo request received:', { id: record._id, requestType: normalizedType, source });
    res.json({ success: true, message: 'Demo request received' });
  } catch (error) {
    console.error('Error processing demo request:', error);
    res.status(500).json({ error: 'Failed to process demo request' });
  }
});

module.exports = router;
