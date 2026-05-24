const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const { requireAuth } = require('../middleware/auth');
const { requirePermissions } = require('../middleware/permissions');
const CareDocument = require('../models/CareDocument');
const CareChunk = require('../models/CareChunk');
const AuditEvent = require('../models/AuditEvent');
const { chunkText } = require('../utils/chunkText');
const { embedText } = require('../services/embeddingService');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

async function extractText(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  const name = String(file.originalname || '').toLowerCase();

  if (mime.includes('pdf') || name.endsWith('.pdf')) {
    const parsed = await pdfParse(file.buffer);
    return parsed.text || '';
  }

  return file.buffer.toString('utf8');
}

router.post('/upload', requireAuth, requirePermissions('documents:upload'), upload.single('document'), async (req, res) => {
  try {
    const { clientId, docType, title, effectiveDate } = req.body || {};
    if (!req.file) return res.status(400).json({ error: 'document file required' });
    if (!clientId || !docType || !title) return res.status(400).json({ error: 'clientId, docType, title required' });

    const extractedText = (await extractText(req.file)).trim();
    if (!extractedText) {
      return res.status(400).json({ error: 'No text extracted from document' });
    }

    const document = await CareDocument.create({
      orgId: req.user.orgId,
      clientId,
      docType,
      title,
      sourceFileName: req.file.originalname,
      effectiveDate: effectiveDate ? new Date(effectiveDate) : null,
      uploadedBy: req.user._id,
      extractedText
    });

    const pieces = chunkText(extractedText, 1200, 200);
    const chunkDocs = [];

    for (let i = 0; i < pieces.length; i += 1) {
      const content = pieces[i];
      const embedding = await embedText(content);
      chunkDocs.push({
        orgId: req.user.orgId,
        clientId,
        documentId: document._id,
        chunkIndex: i,
        content,
        embedding,
        sourceMeta: {
          sourceFileName: req.file.originalname,
          sectionHint: `Chunk ${i + 1}`
        }
      });
    }

    await CareChunk.insertMany(chunkDocs);

    await AuditEvent.create({
      orgId: req.user.orgId,
      userId: req.user._id,
      clientId,
      eventType: 'upload_document',
      payload: {
        documentId: document._id,
        sourceFileName: req.file.originalname,
        chunkCount: chunkDocs.length,
        docType
      }
    });

    return res.status(201).json({
      documentId: document._id,
      chunkCount: chunkDocs.length
    });
  } catch (error) {
    return res.status(500).json({ error: 'Upload failed' });
  }
});

module.exports = router;
