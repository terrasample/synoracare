const express = require('express');
const { requireAuth } = require('../middleware/auth');
const Assignment = require('../models/Assignment');
const Client = require('../models/Client');
const AuditEvent = require('../models/AuditEvent');
const { retrieveTopChunks } = require('../services/retrievalService');
const { buildGroundedAnswer } = require('../services/answerService');

const router = express.Router();

const ISP_SECTION_RULES = {
  diet: ['diet', 'meal', 'nutrition', 'food', 'feeding', 'texture', 'swallow'],
  allergies: ['allerg', 'intoleran', 'anaphyl', 'reaction', 'epipen'],
  behavior: ['behavior', 'trigger', 'de-escalat', 'redirect', 'agitat', 'calm'],
  protocols: ['assist', 'protocol', 'support', 'step', 'supervision', 'monitor', 'safety']
};

function deriveSectionFromChunks(chunks, terms) {
  const snippets = [];
  const lowerTerms = terms.map((term) => term.toLowerCase());

  for (const chunk of chunks.slice(0, 6)) {
    const sentences = String(chunk.content || '')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase();
      if (lowerTerms.some((term) => normalized.includes(term))) {
        snippets.push(sentence);
      }
      if (snippets.length >= 2) break;
    }

    if (snippets.length >= 2) break;
  }

  return snippets;
}

function buildIspAssistantSnapshot({ clientName, chunks }) {
  const citations = chunks.slice(0, 4).map((chunk) => ({
    chunkId: String(chunk._id),
    sourceFileName: chunk.sourceMeta?.sourceFileName || 'Document',
    sectionHint: chunk.sourceMeta?.sectionHint || '',
    excerpt: String(chunk.content || '').slice(0, 280)
  }));

  const dietSnippets = deriveSectionFromChunks(chunks, ISP_SECTION_RULES.diet);
  const allergySnippets = deriveSectionFromChunks(chunks, ISP_SECTION_RULES.allergies);
  const behaviorSnippets = deriveSectionFromChunks(chunks, ISP_SECTION_RULES.behavior);
  const protocolSnippets = deriveSectionFromChunks(chunks, ISP_SECTION_RULES.protocols);

  const structured = {
    diet: dietSnippets.join(' '),
    allergies: allergySnippets.join(' '),
    behavior: behaviorSnippets.join(' '),
    protocols: protocolSnippets.join(' ')
  };

  const missingSections = Object.entries(structured)
    .filter(([, value]) => !String(value || '').trim())
    .map(([key]) => key);

  const escalationRequired = chunks.length === 0 || missingSections.length > 0;
  const escalationMessage = escalationRequired
    ? `Escalate before proceeding. Missing required sections: ${missingSections.length ? missingSections.join(', ') : 'care documentation'}.`
    : '';

  const answer = escalationRequired
    ? `I found partial guidance for ${clientName}, but required safety fields are missing. Do not proceed until supervisor review is complete.`
    : `Here is the meal-support snapshot for ${clientName} using current care documents.`;

  return {
    answer,
    grounded: chunks.length > 0,
    citations,
    sources: citations,
    structured,
    missingSections,
    escalationRequired,
    escalationMessage
  };
}

async function enforceAccess(req, clientId, question) {
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

    return {
      allowed: false,
      response: {
        status: 403,
        body: {
          error: 'No access to this client',
          alertTriggered: recentForbiddenCount >= 3,
          recentForbiddenCount
        }
      }
    };
  }

  return { allowed: true, access };
}

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

    const gate = await enforceAccess(req, clientId, question);
    if (!gate.allowed) return res.status(gate.response.status).json(gate.response.body);
    const access = gate.access;

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

router.post('/isp-assistant', requireAuth, async (req, res) => {
  try {
    const { clientId } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId required' });

    const question = 'How should I assist this client with meals? Include dietary restrictions, allergies, behavior supports, and assistance protocols.';

    const gate = await enforceAccess(req, clientId, question);
    if (!gate.allowed) return res.status(gate.response.status).json(gate.response.body);
    const access = gate.access;

    const client = await Client.findOne({ _id: clientId, orgId: req.user.orgId }).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const chunks = await retrieveTopChunks({
      orgId: req.user.orgId,
      clientId,
      question,
      limit: 8
    });

    const response = buildIspAssistantSnapshot({
      clientName: client.displayName,
      chunks
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'ask_question',
      payload: {
        question,
        assistantMode: 'isp_meal',
        grounded: response.grounded,
        citationCount: response.citations.length,
        missingSections: response.missingSections,
        escalationRequired: response.escalationRequired,
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
    return res.status(500).json({ error: 'ISP assistant request failed' });
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
