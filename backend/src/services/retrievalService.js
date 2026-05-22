const CareChunk = require('../models/CareChunk');
const { embedText } = require('./embeddingService');
const { cosineSimilarity } = require('../utils/cosine');

async function retrieveTopChunks({ orgId, clientId, question, limit = 6 }) {
  const questionEmbedding = await embedText(question);
  if (!questionEmbedding.length) return [];

  const chunks = await CareChunk.find({ orgId, clientId }).lean();
  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(questionEmbedding, chunk.embedding || [])
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .filter((chunk) => chunk.score > 0.12);

  return scored;
}

module.exports = { retrieveTopChunks };
