const OpenAI = require('openai');
const env = require('../config/env');

const client = env.openAiKey ? new OpenAI({ apiKey: env.openAiKey }) : null;

function fallbackEmbedding(text = '', size = 256) {
  const vector = Array.from({ length: size }, () => 0);
  const clean = String(text || '').toLowerCase();
  for (let i = 0; i < clean.length; i += 1) {
    const code = clean.charCodeAt(i);
    vector[i % size] += (code % 97) / 100;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0)) || 1;
  return vector.map((n) => n / magnitude);
}

async function embedText(text = '') {
  const input = String(text || '').slice(0, 12000);
  if (!input) return [];

  if (!client) {
    return fallbackEmbedding(input);
  }

  const res = await client.embeddings.create({
    model: env.openAiEmbeddingModel,
    input
  });

  return res.data[0].embedding;
}

module.exports = { embedText };
