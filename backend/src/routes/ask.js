const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Assignment = require('../models/Assignment');
const Client = require('../models/Client');
const AuditEvent = require('../models/AuditEvent');
const { retrieveTopChunks } = require('../services/retrievalService');
const { buildGroundedAnswer } = require('../services/answerService');

const router = express.Router();

async function getClientAccess(user, clientId) {
  if (['super_admin', 'org_admin', 'supervisor'].includes(user.role)) {
    return { allowed: true, assignment: null };
  }

  const now = new Date();
  const assignment = await Assignment.findOne({
    orgId: user.orgId,
    userId: user._id,
    clientId,
    startsAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  }).lean();

  return { allowed: !!assignment, assignment };
}

router.post('/', requireAuth, async (req, res) => {
  try {
    const { clientId, question } = req.body || {};
    if (!clientId || !question) return res.status(400).json({ error: 'clientId and question required' });

    const access = await getClientAccess(req.user, clientId);
    if (!access.allowed) {
      await AuditEvent.create({
        orgId: req.user.orgId,
        userId: req.user._id,
        clientId,
        eventType: 'forbidden_access',
        payload: {
          action: 'ask_question',
          question: String(question || '').slice(0, 400)
        }
      });

      const lookback = new Date(Date.now() - 15 * 60 * 1000);
      const recentForbiddenCount = await AuditEvent.countDocuments({
        orgId: req.user.orgId,
        userId: req.user._id,
        eventType: 'forbidden_access',
        createdAt: { $gte: lookback }
      });

      if (recentForbiddenCount >= 3) {
        await AuditEvent.create({
          orgId: req.user.orgId,
          userId: req.user._id,
          clientId,
          eventType: 'security_alert',
          payload: {
            alertType: 'repeated_forbidden_access',
            recentForbiddenCount,
            windowMinutes: 15
          }
        });
      }

      return res.status(403).json({
        error: 'No access to this client',
        alertTriggered: recentForbiddenCount >= 3,
        recentForbiddenCount
      });
    }

    const client = await Client.findOne({ _id: clientId, orgId: req.user.orgId }).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const chunks = await retrieveTopChunks({
      orgId: req.user.orgId,
      clientId,
      question,
      limit: 6
    });

    const response = await buildGroundedAnswer({
      clientName: client.displayName,
      question,
      chunks
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'ask_question',
      payload: {
        question,
        grounded: response.grounded,
        citationCount: response.citations.length,
        topChunkIds: chunks.map((chunk) => String(chunk._id))
      }
    });

    if (access.assignment && access.assignment.isBreakGlass) {
      await AuditEvent.create({
        orgId: req.user.orgId,
        userId: req.user._id,
        clientId,
        eventType: 'break_glass_access',
        payload: {
          assignmentId: String(access.assignment._id),
          expiresAt: access.assignment.expiresAt,
          reason: access.assignment.breakGlassReason || ''
        }
      });
    }

    return res.json(response);
  } catch (error) {
    return res.status(500).json({ error: 'Question failed' });
  }
});

router.post('/escalate', requireAuth, async (req, res) => {
  try {
    const { clientId, reason } = req.body || {};
    if (!clientId || !reason) return res.status(400).json({ error: 'clientId and reason required' });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'escalation',
      payload: { reason }
    });

    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: 'Escalation failed' });
  }
});

module.exports = router;
