const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../../.env') });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseOrigins(value, fallback) {
  return String(value || fallback)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const corsOrigins = parseOrigins(process.env.CORS_ORIGIN, 'http://localhost:8080');

module.exports = {
  port: Number(process.env.PORT || 8081),
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/careguide_assistant',
  allowInMemoryMongo: String(process.env.ALLOW_INMEMORY_MONGO || 'true').toLowerCase() === 'true',
  jwtSecret: process.env.JWT_SECRET || 'dev_secret_change_me',
  openAiKey: process.env.OPENAI_API_KEY || '',
  openAiChatModel: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
  openAiEmbeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
  corsOrigins,
  corsOrigin: corsOrigins[0],
  required
};
