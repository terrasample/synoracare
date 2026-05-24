const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const Assignment = require('../models/Assignment');
const Client = require('../models/Client');
const CareDocument = require('../models/CareDocument');
const TrackerEntry = require('../models/TrackerEntry');
const AuditEvent = require('../models/AuditEvent');
const Organization = require('../models/Organization');
const { inferRetentionYears, normalizeStateCode } = require('../utils/retentionPolicy');
const { canRole } = require('../config/accessControl');

const router = express.Router();

async function getAccessibleClientIds(user) {
  if (canRole(user.role, 'clients:all:read')) {
    const clients = await Client.find({ orgId: user.orgId }).select('_id').lean();
    return clients.map((c) => String(c._id));
  }

  const now = new Date();
  const assignments = await Assignment.find({
    orgId: user.orgId,
    userId: user._id,
    startsAt: { $lte: now },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  })
    .select('clientId')
    .lean();

  return assignments.map((a) => String(a.clientId));
}

router.post('/export', requireAuth, requirePermissions('legal_records:export'), async (req, res) => {
  try {
    const { clientId, stateCode, retentionYearsOverride, includeAudit = true } = req.body || {};
    if (!clientId) return res.status(400).json({ error: 'clientId is required' });

    const accessibleClientIds = await getAccessibleClientIds(req.user);
    if (!accessibleClientIds.includes(String(clientId))) {
      return res.status(403).json({ error: 'No access to this client' });
    }

    const organization = await Organization.findById(req.user.orgId).lean();
    const inferredPolicy = inferRetentionYears(
      stateCode || organization?.stateCode,
      retentionYearsOverride || organization?.legalRetentionYearsOverride
    );

    const now = new Date();
    const cutoffDate = new Date(now);
    cutoffDate.setFullYear(cutoffDate.getFullYear() - inferredPolicy.years);

    const [client, documents, trackerEntries, auditEvents] = await Promise.all([
      Client.findOne({ _id: clientId, orgId: req.user.orgId }).lean(),
      CareDocument.find({ orgId: req.user.orgId, clientId, createdAt: { $gte: cutoffDate } })
        .select('_id docType title sourceFileName effectiveDate isActive createdAt updatedAt')
        .sort({ createdAt: -1 })
        .lean(),
      TrackerEntry.find({ orgId: req.user.orgId, clientId, createdAt: { $gte: cutoffDate } })
        .select('_id eventType priority status summary details photo photoCaption dueAt completedAt createdAt updatedAt')
        .sort({ createdAt: -1 })
        .lean(),
      includeAudit
        ? AuditEvent.find({ orgId: req.user.orgId, clientId, createdAt: { $gte: cutoffDate } })
            .select('_id eventType payload createdAt userId')
            .sort({ createdAt: -1 })
            .limit(1000)
            .lean()
        : Promise.resolve([])
    ]);

    if (!client) return res.status(404).json({ error: 'Client not found' });

    const trackerWithEvidence = trackerEntries.map((entry) => {
      const hasPhoto = Boolean(entry.photo && entry.photo.contentType);
      return {
        ...entry,
        photo: hasPhoto
          ? {
              fileName: entry.photo.fileName,
              contentType: entry.photo.contentType,
              size: entry.photo.size,
              capturedAt: entry.photo.capturedAt,
              evidenceUrl: `/api/tracker/${entry._id}/photo`
            }
          : null
      };
    });

    const payload = {
      exportMeta: {
        generatedAt: now,
        generatedBy: req.user._id,
        retentionPolicy: {
          stateCode: normalizeStateCode(inferredPolicy.stateCode),
          years: inferredPolicy.years,
          source: inferredPolicy.source,
          cutoffDate
        },
        legalDisclaimer: 'Retention windows vary by jurisdiction and case type. Confirm with legal counsel before disclosure.'
      },
      organization: {
        id: organization?._id,
        name: organization?.name,
        slug: organization?.slug,
        stateCode: organization?.stateCode || null
      },
      client: {
        id: client._id,
        displayName: client.displayName,
        externalId: client.externalId,
        status: client.status
      },
      records: {
        documents,
        trackerEntries: trackerWithEvidence,
        auditEvents
      },
      counts: {
        documents: documents.length,
        trackerEntries: trackerWithEvidence.length,
        auditEvents: auditEvents.length
      }
    };

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'legal_records_export',
      payload: {
        retentionYears: inferredPolicy.years,
        stateCode: inferredPolicy.stateCode,
        source: inferredPolicy.source,
        cutoffDate,
        counts: payload.counts
      }
    });

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to export legal records' });
  }
});

module.exports = router;
