const express = require('express');

const router = express.Router();

// POST demo request
router.post('/demo-request', async (req, res) => {
  try {
    const { organizationName, contactName, email, phone, message } = req.body;

    // Validate required fields
    if (!organizationName || !contactName || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Log the demo request (in production, this would be saved to a database or sent via email)
    console.log('Demo request received:', {
      organizationName,
      contactName,
      email,
      phone,
      message,
      timestamp: new Date().toISOString()
    });

    // TODO: Send email notification or save to database
    // For now, just acknowledge the request
    res.json({ success: true, message: 'Demo request received' });
  } catch (error) {
    console.error('Error processing demo request:', error);
    res.status(500).json({ error: 'Failed to process demo request' });
  }
});

module.exports = router;
