const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const { getEffectivePermissionsForUser } = require('../config/accessControl');
const PolicyDocument = require('../models/PolicyDocument');
const PolicyAcknowledgement = require('../models/PolicyAcknowledgement');
const PolicyRevision = require('../models/PolicyRevision');
const PolicyNotification = require('../models/PolicyNotification');
const PolicyEmailNotification = require('../models/PolicyEmailNotification');
const User = require('../models/User');
const AuditEvent = require('../models/AuditEvent');

const router = express.Router();

const DEFAULT_TEMPLATES = [
  {
    title: 'DSP Injury Response Procedure',
    slug: 'dsp-injury-response-procedure',
    category: 'health-and-safety',
    incidentTypes: ['dsp-injury', 'workplace-injury'],
    appliesTo: ['dsp', 'supervisor', 'org_admin'],
    summary: 'Immediate response workflow when a DSP is injured while on shift.',
    immediateActions: [
      'Ensure scene is safe and remove immediate hazards.',
      'Call 911 for severe injuries and notify supervisor immediately.',
      'Provide first aid until trained medical help arrives.'
    ],
    procedureSteps: [
      'Open incident case in SynoraCare within 30 minutes.',
      'Capture facts, witnesses, and contributing conditions.',
      'Submit workers compensation intake before shift end.',
      'Schedule return-to-work review within 24 hours.'
    ],
    reportingRequirements: [
      'Incident report due within 2 hours.',
      'Supervisor review due same shift.'
    ],
    contacts: [
      { role: 'On-Call Supervisor', phone: '(800) 555-0101', email: 'oncall@synoracare.ai' }
    ],
    version: '1.0'
  },
  {
    title: 'Client Injury Escalation Procedure',
    slug: 'client-injury-escalation-procedure',
    category: 'incident-response',
    incidentTypes: ['client-injury'],
    appliesTo: ['dsp', 'supervisor', 'org_admin'],
    summary: 'Protect client safety first, escalate quickly, then complete required reporting.',
    immediateActions: [
      'Stabilize client and call emergency services if needed.',
      'Notify nurse/clinical lead and supervisor.',
      'Stay with client until handoff is complete.'
    ],
    procedureSteps: [
      'Complete immediate assessment and document observations.',
      'Notify guardian/responsible party per care plan.',
      'Log incident details and follow-up actions in tracker.'
    ],
    reportingRequirements: [
      'Initial incident log created immediately.',
      'Final incident report completed before shift end.'
    ],
    contacts: [
      { role: 'Clinical On-Call', phone: '(800) 555-0110', email: 'clinical@synoracare.ai' }
    ],
    version: '1.0'
  },
  {
    title: 'Medication Error Immediate Response',
    slug: 'medication-error-immediate-response',
    category: 'incident-response',
    incidentTypes: ['medication-error'],
    appliesTo: ['dsp', 'supervisor', 'org_admin'],
    summary: 'Steps for handling medication errors and coordinating urgent clinical follow-up.',
    immediateActions: [
      'Assess client condition immediately.',
      'Notify nurse/clinical lead and supervisor.',
      'Call emergency services if symptoms indicate acute risk.'
    ],
    procedureSteps: [
      'Document medication variance and timeline.',
      'Complete physician or nurse follow-up documentation.',
      'Record corrective actions and coaching steps.'
    ],
    reportingRequirements: [
      'Clinical escalation immediate.',
      'Variance report before shift close.'
    ],
    contacts: [
      { role: 'Medication Safety Lead', phone: '(800) 555-0140', email: 'medsafety@synoracare.ai' }
    ],
    version: '1.0'
  },
  {
    title: 'Incident Reporting and Investigation SOP',
    slug: 'incident-reporting-investigation-sop',
    category: 'compliance',
    incidentTypes: ['dsp-injury', 'client-injury', 'medication-error', 'safety-hazard', 'property-damage'],
    appliesTo: ['all-staff'],
    summary: 'Standardized incident classification, investigation, and closure process.',
    immediateActions: [
      'Classify incident severity and escalation tier.',
      'Escalate high-severity incidents to leadership immediately.',
      'Preserve scene details and witness notes.'
    ],
    procedureSteps: [
      'Create incident case and assign owner.',
      'Collect timeline, witness, and supporting documentation.',
      'Record root cause and preventive actions.',
      'Close after approvals and action verification.'
    ],
    reportingRequirements: [
      'All incidents logged same day.',
      'Monthly incident trend review with leadership.'
    ],
    contacts: [
      { role: 'Compliance Officer', phone: '(800) 555-0120', email: 'compliance@synoracare.ai' }
    ],
    version: '1.0'
  }
];

function normalizeIncidentType(rawType) {
  return String(rawType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/_/g, '-');
}

function normalizeSlug(rawValue) {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function sanitizeArray(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  return rawValue
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function hasPolicyAdminAccess(user) {
  const permissions = getEffectivePermissionsForUser(user);
  return permissions.includes('policies:update') || permissions.includes('policies:approve');
}

function buildPolicySnapshot(policy) {
  const source = typeof policy.toObject === 'function' ? policy.toObject() : policy;
  return {
    title: source.title,
    slug: source.slug,
    category: source.category,
    incidentTypes: Array.isArray(source.incidentTypes) ? [...source.incidentTypes] : [],
    appliesTo: Array.isArray(source.appliesTo) ? [...source.appliesTo] : [],
    summary: source.summary || '',
    immediateActions: Array.isArray(source.immediateActions) ? [...source.immediateActions] : [],
    procedureSteps: Array.isArray(source.procedureSteps) ? [...source.procedureSteps] : [],
    reportingRequirements: Array.isArray(source.reportingRequirements) ? [...source.reportingRequirements] : [],
    contacts: Array.isArray(source.contacts) ? source.contacts.map((contact) => ({
      role: String(contact?.role || ''),
      phone: String(contact?.phone || ''),
      email: String(contact?.email || '')
    })) : [],
    effectiveDate: source.effectiveDate || null,
    lastReviewedAt: source.lastReviewedAt || null,
    workflowStatus: source.workflowStatus || 'draft',
    isActive: Boolean(source.isActive)
  };
}

async function recordRevision(policy, userId, changeType, note = '') {
  await PolicyRevision.create({
    orgId: policy.orgId,
    policyId: policy._id,
    version: Number(policy.currentVersion || 1),
    status: String(policy.workflowStatus || ''),
    changeType,
    note: String(note || '').trim(),
    snapshot: buildPolicySnapshot(policy),
    changedBy: userId
  });
}

async function createPolicyNotifications({ orgId, actorUserId, policy, type, message }) {
  const activeUsers = await User.find({ orgId, status: 'active', _id: { $ne: actorUserId } })
    .select('_id email fullName')
    .lean();

  if (!activeUsers.length) return;

  const usersWithEmail = activeUsers.filter((user) => String(user.email || '').trim());

  await PolicyNotification.insertMany(activeUsers.map((user) => ({
    orgId,
    userId: user._id,
    policyId: policy._id,
    type,
    title: policy.title,
    message
  })));

  if (usersWithEmail.length) {
    await PolicyEmailNotification.insertMany(usersWithEmail.map((user) => ({
      orgId,
      userId: user._id,
      policyId: policy._id,
      toEmail: String(user.email || '').toLowerCase(),
      subject: `SynoraCare Policy Update: ${policy.title}`,
      body: `${message}\n\nPolicy: ${policy.title}\nVersion: ${policy.version}\nOrganization: ${String(orgId)}`
    })));
  }
}

async function ensureOrgPolicySeed(orgId, userId) {
  if (!orgId) return;

  const existingCount = await PolicyDocument.countDocuments({ orgId });
  if (existingCount > 0) return;

  const seedDocs = DEFAULT_TEMPLATES.map((template) => ({
    orgId,
    title: template.title,
    slug: template.slug,
    category: template.category,
    incidentTypes: (template.incidentTypes || []).map((type) => normalizeIncidentType(type)),
    appliesTo: template.appliesTo || [],
    summary: template.summary,
    immediateActions: template.immediateActions || [],
    procedureSteps: template.procedureSteps || [],
    reportingRequirements: template.reportingRequirements || [],
    contacts: template.contacts || [],
    version: template.version || '1.0',
    currentVersion: 1,
    effectiveDate: new Date(),
    lastReviewedAt: new Date(),
    workflowStatus: 'published',
    publishedAt: new Date(),
    approvedAt: new Date(),
    approvedBy: userId || null,
    isActive: true,
    createdBy: userId || null,
    updatedBy: userId || null
  }));

  await PolicyDocument.insertMany(seedDocs);
}

function buildFilter(req) {
  const query = String(req.query.query || '').trim().toLowerCase();
  const category = String(req.query.category || '').trim();
  const incidentType = normalizeIncidentType(req.query.incidentType);

  return { query, category, incidentType };
}

// Super-admin can pass ?viewOrgId=<id> to inspect any org's policies.
function resolveOrgId(req) {
  const viewOrgId = String(req.query.viewOrgId || req.body?.viewOrgId || '').trim();
  if (viewOrgId && String(req.user.role || '') === 'super_admin') return viewOrgId;
  return String(req.user.orgId || '');
}

router.use(requireAuth);

router.get('/', requirePermissions('policies:read'), async (req, res) => {
  try {
    await ensureOrgPolicySeed(resolveOrgId(req), req.user._id);

    const { query, category, incidentType } = buildFilter(req);

    const includeDrafts = String(req.query.includeDrafts || '').toLowerCase() === 'true';
    const dbQuery = { orgId: resolveOrgId(req) };
    if (includeDrafts && hasPolicyAdminAccess(req.user)) {
      dbQuery.workflowStatus = { $ne: 'archived' };
    } else {
      dbQuery.workflowStatus = 'published';
      dbQuery.isActive = true;
    }

    if (category) dbQuery.category = category;
    if (incidentType) dbQuery.incidentTypes = incidentType;

    let policies = await PolicyDocument.find(dbQuery)
      .sort({ updatedAt: -1 })
      .lean();

    if (query) {
      policies = policies.filter((policy) => {
        const haystack = [
          policy.title,
          policy.summary,
          ...(policy.procedureSteps || []),
          ...(policy.immediateActions || []),
          ...(policy.reportingRequirements || [])
        ]
          .join(' ')
          .toLowerCase();

        return haystack.includes(query);
      });
    }

    return res.json({
      policies,
      meta: {
        orgId: resolveOrgId(req),
        total: policies.length
      }
    });
  } catch (error) {
    console.error('Policy list error:', error);
    return res.status(500).json({ error: 'Failed to load policies' });
  }
});

router.get('/incident/:incidentType', requirePermissions('policies:read'), async (req, res) => {
  try {
    await ensureOrgPolicySeed(resolveOrgId(req), req.user._id);

    const incidentType = normalizeIncidentType(req.params.incidentType);
    if (!incidentType) {
      return res.status(400).json({ error: 'Incident type is required' });
    }

    const includeDrafts = String(req.query.includeDrafts || '').toLowerCase() === 'true';
    const dbQuery = {
      orgId: resolveOrgId(req),
      incidentTypes: incidentType
    };
    if (includeDrafts && hasPolicyAdminAccess(req.user)) {
      dbQuery.workflowStatus = { $ne: 'archived' };
    } else {
      dbQuery.workflowStatus = 'published';
      dbQuery.isActive = true;
    }

    const policies = await PolicyDocument.find(dbQuery)
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ incidentType, policies });
  } catch (error) {
    console.error('Policy incident lookup error:', error);
    return res.status(500).json({ error: 'Failed to load incident policies' });
  }
});

router.get('/ack/me/list', requirePermissions('policies:ack'), async (req, res) => {
  try {
    const acknowledgements = await PolicyAcknowledgement.find({
      orgId: resolveOrgId(req),
      userId: req.user._id
    })
      .sort({ acknowledgedAt: -1 })
      .lean();

    return res.json({ acknowledgements });
  } catch (error) {
    console.error('Acknowledgement list error:', error);
    return res.status(500).json({ error: 'Failed to load acknowledgements' });
  }
});

router.get('/dashboard/read-receipts', requirePermissions('policies:read_receipts'), async (req, res) => {
  try {
    const [users, policies, acknowledgements] = await Promise.all([
      User.find({ orgId: resolveOrgId(req), status: 'active' })
        .select('_id fullName email role')
        .sort({ fullName: 1 })
        .lean(),
      PolicyDocument.find({ orgId: resolveOrgId(req), workflowStatus: 'published', isActive: true })
        .select('_id title slug currentVersion version publishedAt')
        .sort({ updatedAt: -1 })
        .lean(),
      PolicyAcknowledgement.find({ orgId: resolveOrgId(req) })
        .select('policyId userId acknowledgedAt')
        .lean()
    ]);

    const policyIds = new Set(policies.map((policy) => String(policy._id)));
    const ackMap = new Map();
    acknowledgements.forEach((ack) => {
      const key = `${String(ack.policyId)}::${String(ack.userId)}`;
      ackMap.set(key, ack.acknowledgedAt || null);
    });

    const rows = policies.map((policy) => {
      const acknowledgedUsers = [];
      const pendingUsers = [];

      users.forEach((user) => {
        const key = `${String(policy._id)}::${String(user._id)}`;
        const acknowledgedAt = ackMap.get(key);
        if (acknowledgedAt) {
          acknowledgedUsers.push({
            userId: user._id,
            fullName: user.fullName,
            email: user.email,
            acknowledgedAt
          });
        } else {
          pendingUsers.push({
            userId: user._id,
            fullName: user.fullName,
            email: user.email
          });
        }
      });

      const totalUsers = users.length;
      const acknowledgedCount = acknowledgedUsers.length;
      const coveragePct = totalUsers ? Math.round((acknowledgedCount / totalUsers) * 100) : 0;

      return {
        policyId: policy._id,
        title: policy.title,
        slug: policy.slug,
        version: policy.version,
        currentVersion: policy.currentVersion,
        publishedAt: policy.publishedAt,
        totalUsers,
        acknowledgedCount,
        pendingCount: pendingUsers.length,
        coveragePct,
        acknowledgedUsers,
        pendingUsers
      };
    });

    return res.json({
      readReceipts: rows,
      meta: {
        orgId: resolveOrgId(req),
        users: users.length,
        policies: policyIds.size
      }
    });
  } catch (error) {
    console.error('Policy read-receipts error:', error);
    return res.status(500).json({ error: 'Failed to load read receipts dashboard' });
  }
});

router.get('/notifications/me', requirePermissions('policies:notifications:read'), async (req, res) => {
  try {
    const notifications = await PolicyNotification.find({ orgId: resolveOrgId(req), userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const unreadCount = notifications.filter((item) => !item.isRead).length;
    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Policy notifications error:', error);
    return res.status(500).json({ error: 'Failed to load policy notifications' });
  }
});

router.get('/notifications/email-queue', requirePermissions('policies:read_receipts'), async (req, res) => {
  try {
    const emails = await PolicyEmailNotification.find({ orgId: resolveOrgId(req) })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return res.json({ emails });
  } catch (error) {
    console.error('Policy email queue error:', error);
    return res.status(500).json({ error: 'Failed to load policy email queue' });
  }
});

router.post('/notifications/:id/read', requirePermissions('policies:notifications:read'), async (req, res) => {
  try {
    const notification = await PolicyNotification.findOneAndUpdate(
      { _id: req.params.id, orgId: resolveOrgId(req), userId: req.user._id },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();

    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    return res.json({ ok: true, notification });
  } catch (error) {
    console.error('Policy notification read error:', error);
    return res.status(500).json({ error: 'Failed to update notification' });
  }
});

router.get('/:id/history', requirePermissions('policies:history:read'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) }).lean()
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) }).lean();

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const revisions = await PolicyRevision.find({ orgId: resolveOrgId(req), policyId: policy._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ policyId: policy._id, revisions });
  } catch (error) {
    console.error('Policy history error:', error);
    return res.status(500).json({ error: 'Failed to load policy history' });
  }
});

router.get('/:id', requirePermissions('policies:read'), async (req, res) => {
  try {
    await ensureOrgPolicySeed(resolveOrgId(req), req.user._id);

    const id = String(req.params.id || '').trim();
    let policy = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      policy = await PolicyDocument.findOne({
        _id: id,
        orgId: resolveOrgId(req)
      }).lean();
    }

    if (!policy) {
      policy = await PolicyDocument.findOne({
        slug: id.toLowerCase(),
        orgId: resolveOrgId(req)
      }).lean();
    }

    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    if (policy.workflowStatus !== 'published' && !hasPolicyAdminAccess(req.user)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!policy.isActive && policy.workflowStatus !== 'published') {
      return res.status(404).json({ error: 'Policy not found' });
    }

    return res.json({ policy });
  } catch (error) {
    console.error('Policy detail error:', error);
    return res.status(500).json({ error: 'Failed to load policy' });
  }
});

router.post('/:id/ack', requirePermissions('policies:ack'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim();

    let policy = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      policy = await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req), isActive: true, workflowStatus: 'published' }).lean();
    }
    if (!policy) {
      policy = await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req), isActive: true, workflowStatus: 'published' }).lean();
    }

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const acknowledgement = await PolicyAcknowledgement.findOneAndUpdate(
      {
        orgId: resolveOrgId(req),
        userId: req.user._id,
        policyId: policy._id
      },
      {
        orgId: resolveOrgId(req),
        userId: req.user._id,
        policyId: policy._id,
        policySlug: policy.slug,
        note,
        acknowledgedAt: new Date()
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    ).lean();

    await AuditEvent.create({
      orgId: resolveOrgId(req),
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'policy_acknowledged',
        policyId: policy._id,
        policySlug: policy.slug
      }
    });

    return res.json({ ok: true, acknowledgement });
  } catch (error) {
    console.error('Policy acknowledgement error:', error);
    return res.status(500).json({ error: 'Failed to save acknowledgement' });
  }
});

router.post('/', requirePermissions('policies:create'), async (req, res) => {
  try {
    const payload = req.body || {};
    const title = String(payload.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = normalizeSlug(payload.slug || title);
    if (!slug) return res.status(400).json({ error: 'Valid slug is required' });

    const existing = await PolicyDocument.findOne({ orgId: resolveOrgId(req), slug }).lean();
    if (existing) return res.status(409).json({ error: 'Policy slug already exists for this organization' });

    const policy = await PolicyDocument.create({
      orgId: resolveOrgId(req),
      title,
      slug,
      category: String(payload.category || 'incident-response'),
      incidentTypes: sanitizeArray(payload.incidentTypes).map((type) => normalizeIncidentType(type)),
      appliesTo: sanitizeArray(payload.appliesTo),
      summary: String(payload.summary || '').trim(),
      immediateActions: sanitizeArray(payload.immediateActions),
      procedureSteps: sanitizeArray(payload.procedureSteps),
      reportingRequirements: sanitizeArray(payload.reportingRequirements),
      contacts: Array.isArray(payload.contacts) ? payload.contacts : [],
      version: String(payload.version || '1.0').trim(),
      currentVersion: Number(payload.currentVersion || 1),
      effectiveDate: payload.effectiveDate ? new Date(payload.effectiveDate) : new Date(),
      lastReviewedAt: payload.lastReviewedAt ? new Date(payload.lastReviewedAt) : new Date(),
      workflowStatus: 'draft',
      isActive: true,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await recordRevision(policy, req.user._id, 'create', 'Initial policy draft created');

    await AuditEvent.create({
      orgId: resolveOrgId(req),
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'policy_created',
        policyId: policy._id,
        slug: policy.slug
      }
    });

    return res.status(201).json({ policy });
  } catch (error) {
    console.error('Policy create error:', error);
    return res.status(500).json({ error: 'Failed to create policy' });
  }
});

router.put('/:id', requirePermissions('policies:update'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const payload = req.body || {};

    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    if (payload.title !== undefined) policy.title = String(payload.title || '').trim() || policy.title;
    if (payload.category !== undefined) policy.category = String(payload.category || '').trim() || policy.category;
    if (payload.summary !== undefined) policy.summary = String(payload.summary || '').trim();
    if (payload.version !== undefined) policy.version = String(payload.version || '').trim() || policy.version;
    if (payload.incidentTypes !== undefined) {
      policy.incidentTypes = sanitizeArray(payload.incidentTypes).map((type) => normalizeIncidentType(type));
    }
    if (payload.appliesTo !== undefined) policy.appliesTo = sanitizeArray(payload.appliesTo);
    if (payload.immediateActions !== undefined) policy.immediateActions = sanitizeArray(payload.immediateActions);
    if (payload.procedureSteps !== undefined) policy.procedureSteps = sanitizeArray(payload.procedureSteps);
    if (payload.reportingRequirements !== undefined) policy.reportingRequirements = sanitizeArray(payload.reportingRequirements);
    if (payload.contacts !== undefined && Array.isArray(payload.contacts)) policy.contacts = payload.contacts;
    if (payload.effectiveDate !== undefined) policy.effectiveDate = payload.effectiveDate ? new Date(payload.effectiveDate) : policy.effectiveDate;
    if (payload.lastReviewedAt !== undefined) policy.lastReviewedAt = payload.lastReviewedAt ? new Date(payload.lastReviewedAt) : policy.lastReviewedAt;
    if (payload.isActive !== undefined) policy.isActive = Boolean(payload.isActive);

    policy.updatedBy = req.user._id;

    if (payload.slug !== undefined) {
      const nextSlug = normalizeSlug(payload.slug || policy.title);
      if (!nextSlug) return res.status(400).json({ error: 'Valid slug is required' });
      if (nextSlug !== policy.slug) {
        const existing = await PolicyDocument.findOne({ orgId: resolveOrgId(req), slug: nextSlug }).lean();
        if (existing) return res.status(409).json({ error: 'Policy slug already exists for this organization' });
        policy.slug = nextSlug;
      }
    }

    policy.workflowStatus = 'draft';
    policy.submittedForReviewAt = null;
    policy.submittedBy = null;
    policy.approvedAt = null;
    policy.approvedBy = null;
    await policy.save();
    await recordRevision(policy, req.user._id, 'update', 'Policy updated and moved to draft');

    await AuditEvent.create({
      orgId: resolveOrgId(req),
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'policy_updated',
        policyId: policy._id,
        slug: policy.slug
      }
    });

    return res.json({ policy: policy.toObject(), workflow: { status: 'draft' } });
  } catch (error) {
    console.error('Policy update error:', error);
    return res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.post('/:id/submit-review', requirePermissions('policies:submit_review'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    if (policy.workflowStatus === 'archived') return res.status(400).json({ error: 'Archived policy cannot be submitted' });

    policy.workflowStatus = 'in_review';
    policy.submittedForReviewAt = new Date();
    policy.submittedBy = req.user._id;
    policy.updatedBy = req.user._id;
    await policy.save();

    await recordRevision(policy, req.user._id, 'submit_review', 'Policy submitted for review');

    return res.json({ ok: true, policy: policy.toObject() });
  } catch (error) {
    console.error('Policy submit-review error:', error);
    return res.status(500).json({ error: 'Failed to submit policy for review' });
  }
});

router.post('/:id/approve-publish', requirePermissions('policies:approve'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim();
    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    if (policy.workflowStatus === 'archived') return res.status(400).json({ error: 'Archived policy cannot be published' });

    const hasPublishedBefore = Boolean(policy.publishedAt);
    policy.currentVersion = hasPublishedBefore ? Number(policy.currentVersion || 1) + 1 : Math.max(1, Number(policy.currentVersion || 1));
    policy.version = `${policy.currentVersion}.0`;
    policy.workflowStatus = 'published';
    policy.publishedAt = new Date();
    policy.approvedAt = new Date();
    policy.approvedBy = req.user._id;
    policy.isActive = true;
    policy.updatedBy = req.user._id;
    await policy.save();

    await recordRevision(policy, req.user._id, 'publish', note || 'Policy approved and published');
    await createPolicyNotifications({
      orgId: resolveOrgId(req),
      actorUserId: req.user._id,
      policy,
      type: hasPublishedBefore ? 'policy_updated' : 'policy_published',
      message: hasPublishedBefore
        ? `Policy updated: ${policy.title} (v${policy.version})`
        : `New policy published: ${policy.title} (v${policy.version})`
    });

    return res.json({ ok: true, policy: policy.toObject() });
  } catch (error) {
    console.error('Policy publish error:', error);
    return res.status(500).json({ error: 'Failed to publish policy' });
  }
});

router.post('/:id/rollback/:revisionId', requirePermissions('policies:rollback'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const revisionId = String(req.params.revisionId || '').trim();

    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const revision = await PolicyRevision.findOne({ _id: revisionId, orgId: resolveOrgId(req), policyId: policy._id }).lean();
    if (!revision) return res.status(404).json({ error: 'Revision not found' });

    const snapshot = revision.snapshot || {};
    policy.title = String(snapshot.title || policy.title).trim();
    policy.slug = normalizeSlug(snapshot.slug || snapshot.title || policy.slug);
    policy.category = String(snapshot.category || policy.category).trim() || policy.category;
    policy.incidentTypes = sanitizeArray(snapshot.incidentTypes).map((type) => normalizeIncidentType(type));
    policy.appliesTo = sanitizeArray(snapshot.appliesTo);
    policy.summary = String(snapshot.summary || '').trim();
    policy.immediateActions = sanitizeArray(snapshot.immediateActions);
    policy.procedureSteps = sanitizeArray(snapshot.procedureSteps);
    policy.reportingRequirements = sanitizeArray(snapshot.reportingRequirements);
    policy.contacts = Array.isArray(snapshot.contacts) ? snapshot.contacts : [];
    policy.effectiveDate = snapshot.effectiveDate ? new Date(snapshot.effectiveDate) : policy.effectiveDate;
    policy.lastReviewedAt = new Date();
    policy.currentVersion = Number(policy.currentVersion || 1) + 1;
    policy.version = `${policy.currentVersion}.0`;
    policy.workflowStatus = 'published';
    policy.publishedAt = new Date();
    policy.approvedAt = new Date();
    policy.approvedBy = req.user._id;
    policy.isActive = true;
    policy.updatedBy = req.user._id;
    await policy.save();

    await recordRevision(policy, req.user._id, 'rollback', `Rolled back to revision ${revision._id}`);
    await createPolicyNotifications({
      orgId: resolveOrgId(req),
      actorUserId: req.user._id,
      policy,
      type: 'policy_updated',
      message: `Policy rollback published: ${policy.title} (v${policy.version})`
    });

    return res.json({ ok: true, policy: policy.toObject(), restoredFromRevision: revision._id });
  } catch (error) {
    console.error('Policy rollback error:', error);
    return res.status(500).json({ error: 'Failed to rollback policy revision' });
  }
});

async function archivePolicyById(req, res) {
  try {
    const id = String(req.params.id || '').trim();

    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: resolveOrgId(req) })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: resolveOrgId(req) });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    policy.workflowStatus = 'archived';
    policy.isActive = false;
    policy.updatedBy = req.user._id;
    await policy.save();
    await recordRevision(policy, req.user._id, 'archive', 'Policy archived');
    await createPolicyNotifications({
      orgId: resolveOrgId(req),
      actorUserId: req.user._id,
      policy,
      type: 'policy_archived',
      message: `Policy archived: ${policy.title}`
    });

    await AuditEvent.create({
      orgId: resolveOrgId(req),
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'policy_archived',
        policyId: policy._id,
        slug: policy.slug
      }
    });

    return res.json({ ok: true });
  } catch (error) {
    console.error('Policy archive error:', error);
    return res.status(500).json({ error: 'Failed to archive policy' });
  }
}

router.patch('/:id/archive', requirePermissions('policies:archive'), archivePolicyById);

router.delete('/:id', requirePermissions('policies:archive'), async (req, res) => {
  return archivePolicyById(req, res);
});

module.exports = router;
