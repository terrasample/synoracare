const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const { requireRoles } = require('../middleware/rbac');
const PolicyDocument = require('../models/PolicyDocument');
const PolicyAcknowledgement = require('../models/PolicyAcknowledgement');
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
    effectiveDate: new Date(),
    lastReviewedAt: new Date(),
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

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    await ensureOrgPolicySeed(req.user.orgId, req.user._id);

    const { query, category, incidentType } = buildFilter(req);

    const dbQuery = {
      orgId: req.user.orgId,
      isActive: true
    };

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
        orgId: req.user.orgId,
        total: policies.length
      }
    });
  } catch (error) {
    console.error('Policy list error:', error);
    return res.status(500).json({ error: 'Failed to load policies' });
  }
});

router.get('/incident/:incidentType', async (req, res) => {
  try {
    await ensureOrgPolicySeed(req.user.orgId, req.user._id);

    const incidentType = normalizeIncidentType(req.params.incidentType);
    if (!incidentType) {
      return res.status(400).json({ error: 'Incident type is required' });
    }

    const policies = await PolicyDocument.find({
      orgId: req.user.orgId,
      isActive: true,
      incidentTypes: incidentType
    })
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ incidentType, policies });
  } catch (error) {
    console.error('Policy incident lookup error:', error);
    return res.status(500).json({ error: 'Failed to load incident policies' });
  }
});

router.get('/ack/me/list', async (req, res) => {
  try {
    const acknowledgements = await PolicyAcknowledgement.find({
      orgId: req.user.orgId,
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

router.get('/:id', async (req, res) => {
  try {
    await ensureOrgPolicySeed(req.user.orgId, req.user._id);

    const id = String(req.params.id || '').trim();
    let policy = null;

    if (mongoose.Types.ObjectId.isValid(id)) {
      policy = await PolicyDocument.findOne({
        _id: id,
        orgId: req.user.orgId,
        isActive: true
      }).lean();
    }

    if (!policy) {
      policy = await PolicyDocument.findOne({
        slug: id.toLowerCase(),
        orgId: req.user.orgId,
        isActive: true
      }).lean();
    }

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    return res.json({ policy });
  } catch (error) {
    console.error('Policy detail error:', error);
    return res.status(500).json({ error: 'Failed to load policy' });
  }
});

router.post('/:id/ack', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const note = String(req.body?.note || '').trim();

    let policy = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      policy = await PolicyDocument.findOne({ _id: id, orgId: req.user.orgId, isActive: true }).lean();
    }
    if (!policy) {
      policy = await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: req.user.orgId, isActive: true }).lean();
    }

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const acknowledgement = await PolicyAcknowledgement.findOneAndUpdate(
      {
        orgId: req.user.orgId,
        userId: req.user._id,
        policyId: policy._id
      },
      {
        orgId: req.user.orgId,
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
      orgId: req.user.orgId,
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

router.post('/', requireRoles('org_admin', 'super_admin'), async (req, res) => {
  try {
    const payload = req.body || {};
    const title = String(payload.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const slug = normalizeSlug(payload.slug || title);
    if (!slug) return res.status(400).json({ error: 'Valid slug is required' });

    const existing = await PolicyDocument.findOne({ orgId: req.user.orgId, slug }).lean();
    if (existing) return res.status(409).json({ error: 'Policy slug already exists for this organization' });

    const policy = await PolicyDocument.create({
      orgId: req.user.orgId,
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
      effectiveDate: payload.effectiveDate ? new Date(payload.effectiveDate) : new Date(),
      lastReviewedAt: payload.lastReviewedAt ? new Date(payload.lastReviewedAt) : new Date(),
      isActive: payload.isActive !== false,
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await AuditEvent.create({
      orgId: req.user.orgId,
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

router.put('/:id', requireRoles('org_admin', 'super_admin'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const payload = req.body || {};

    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: req.user.orgId })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: req.user.orgId });

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
        const existing = await PolicyDocument.findOne({ orgId: req.user.orgId, slug: nextSlug }).lean();
        if (existing) return res.status(409).json({ error: 'Policy slug already exists for this organization' });
        policy.slug = nextSlug;
      }
    }

    await policy.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      eventType: 'security_alert',
      payload: {
        action: 'policy_updated',
        policyId: policy._id,
        slug: policy.slug
      }
    });

    return res.json({ policy: policy.toObject() });
  } catch (error) {
    console.error('Policy update error:', error);
    return res.status(500).json({ error: 'Failed to update policy' });
  }
});

router.delete('/:id', requireRoles('org_admin', 'super_admin'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();

    const policy = mongoose.Types.ObjectId.isValid(id)
      ? await PolicyDocument.findOne({ _id: id, orgId: req.user.orgId })
      : await PolicyDocument.findOne({ slug: id.toLowerCase(), orgId: req.user.orgId });

    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    policy.isActive = false;
    policy.updatedBy = req.user._id;
    await policy.save();

    await AuditEvent.create({
      orgId: req.user.orgId,
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
});

module.exports = router;
