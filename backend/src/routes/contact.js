const express = require('express');
const DemoRequest = require('../models/DemoRequest');

const router = express.Router();
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_LIMIT_PER_WINDOW = 5;

async function isRateLimited(ipAddress) {
  const windowStart = new Date(Date.now() - REQUEST_WINDOW_MS);
  const recentCount = await DemoRequest.countDocuments({
    'metadata.ip': ipAddress,
    createdAt: { $gte: windowStart }
  });
  return recentCount >= REQUEST_LIMIT_PER_WINDOW;
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

    if (await isRateLimited(ipAddress)) {
      return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
    }

    // Validate required fields
    if (!organizationName || !contactName || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
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
        userAgent: String(req.headers['user-agent'] || '')
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
