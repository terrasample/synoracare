const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const { connectDb } = require('./config/db');

const authRoutes = require('./routes/auth');
const clientRoutes = require('./routes/clients');
const assignmentRoutes = require('./routes/assignments');
const documentRoutes = require('./routes/documents');
const askRoutes = require('./routes/ask');
const auditRoutes = require('./routes/audit');
const trackerRoutes = require('./routes/tracker');
const legalRecordsRoutes = require('./routes/legalRecords');
const contactRoutes = require('./routes/contact');
const shiftsRoutes = require('./routes/shifts');

const app = express();

const allowedOrigins = new Set(env.corsOrigins);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const isLocalhostOrigin = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (allowedOrigins.has(origin) || isLocalhostOrigin) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS origin not allowed: ${origin}`));
  }
}));
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (payload) => {
    if (!env.exposeErrorDetails && res.statusCode >= 500 && payload && typeof payload === 'object' && 'detail' in payload) {
      const sanitized = { ...payload };
      delete sanitized.detail;
      return originalJson(sanitized);
    }
    return originalJson(payload);
  };
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'synoracare-backend' });
});

app.get('/api/status', (_req, res) => {
  res.json({
    status: 'operational',
    service: 'synoracare-backend',
    version: process.env.APP_VERSION || '1.0.0',
    buildDate: process.env.BUILD_DATE || 'development',
    uptime: Math.floor(process.uptime())
  });
});

app.get('/api/status/header-check', (req, res) => {
  const authHeader = String(req.headers.authorization || '');
  res.json({
    ok: true,
    hasAuthorizationHeader: Boolean(authHeader),
    authorizationPrefix: authHeader ? authHeader.slice(0, 16) : ''
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/ask', askRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/legal-records', legalRecordsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/shifts', shiftsRoutes);

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await connectDb();
  app.listen(env.port, () => {
    console.log(`SynoraCare backend listening on ${env.port}`);
  });
}

start().catch((error) => {
  console.error('Startup failed:', error);
  process.exit(1);
});
