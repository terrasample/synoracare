const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

const policiesRouter = require('../src/routes/policies');
const User = require('../src/models/User');
const PolicyDocument = require('../src/models/PolicyDocument');

const TEST_JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';

function signToken(user) {
  return jwt.sign(
    {
      userId: String(user._id),
      orgId: String(user.orgId),
      role: user.role
    },
    TEST_JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function makeRequest(baseUrl, path, token, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { status: response.status, data };
}

let mongod;
let server;
let baseUrl;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());

  const app = express();
  app.use(express.json());
  app.use('/api/policies', policiesRouter);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

test('policy workflow supports draft-review-publish, history, and notifications', async () => {
  const orgId = new mongoose.Types.ObjectId();

  const admin = await User.create({
    orgId,
    fullName: 'Admin User',
    email: 'admin@example.com',
    passwordHash: 'x',
    role: 'org_admin',
    status: 'active',
    customPermissions: [
      'policies:create',
      'policies:update',
      'policies:submit_review',
      'policies:approve',
      'policies:history:read',
      'policies:notifications:read',
      'policies:read_receipts'
    ]
  });

  const staff = await User.create({
    orgId,
    fullName: 'DSP User',
    email: 'dsp@example.com',
    passwordHash: 'x',
    role: 'dsp',
    status: 'active'
  });

  const adminToken = signToken(admin);
  const staffToken = signToken(staff);

  const createRes = await makeRequest(baseUrl, '/api/policies', adminToken, {
    method: 'POST',
    body: {
      title: 'Injury Lift Assist SOP',
      incidentTypes: ['dsp-injury'],
      summary: 'Initial draft summary',
      procedureSteps: ['Stabilize', 'Escalate']
    }
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.policy.workflowStatus, 'draft');

  const policyId = String(createRes.data.policy._id);

  const updateRes = await makeRequest(baseUrl, `/api/policies/${policyId}`, adminToken, {
    method: 'PUT',
    body: {
      summary: 'Updated draft summary',
      procedureSteps: ['Stabilize area', 'Notify supervisor', 'Log incident']
    }
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.policy.workflowStatus, 'draft');

  const submitRes = await makeRequest(baseUrl, `/api/policies/${policyId}/submit-review`, adminToken, {
    method: 'POST'
  });
  assert.equal(submitRes.status, 200);
  assert.equal(submitRes.data.policy.workflowStatus, 'in_review');

  const publishRes = await makeRequest(baseUrl, `/api/policies/${policyId}/approve-publish`, adminToken, {
    method: 'POST',
    body: { note: 'Approved for rollout' }
  });
  assert.equal(publishRes.status, 200);
  assert.equal(publishRes.data.policy.workflowStatus, 'published');

  const historyRes = await makeRequest(baseUrl, `/api/policies/${policyId}/history`, adminToken);
  assert.equal(historyRes.status, 200);
  const changeTypes = historyRes.data.revisions.map((item) => item.changeType);
  assert.ok(changeTypes.includes('create'));
  assert.ok(changeTypes.includes('update'));
  assert.ok(changeTypes.includes('submit_review'));
  assert.ok(changeTypes.includes('publish'));

  const notificationsRes = await makeRequest(baseUrl, '/api/policies/notifications/me', staffToken);
  assert.equal(notificationsRes.status, 200);
  assert.ok(notificationsRes.data.unreadCount >= 1);
});

test('read receipts dashboard tracks acknowledged and pending users', async () => {
  const orgId = new mongoose.Types.ObjectId();

  const admin = await User.create({
    orgId,
    fullName: 'Read Admin',
    email: 'readadmin@example.com',
    passwordHash: 'x',
    role: 'org_admin',
    status: 'active',
    customPermissions: [
      'policies:create',
      'policies:submit_review',
      'policies:approve',
      'policies:read_receipts',
      'policies:history:read'
    ]
  });

  const userA = await User.create({
    orgId,
    fullName: 'DSP A',
    email: 'dspa@example.com',
    passwordHash: 'x',
    role: 'dsp',
    status: 'active'
  });

  const userB = await User.create({
    orgId,
    fullName: 'DSP B',
    email: 'dspb@example.com',
    passwordHash: 'x',
    role: 'dsp',
    status: 'active'
  });

  const adminToken = signToken(admin);
  const userAToken = signToken(userA);

  const createRes = await makeRequest(baseUrl, '/api/policies', adminToken, {
    method: 'POST',
    body: {
      title: 'Medication Variance SOP',
      incidentTypes: ['medication-error']
    }
  });
  const policyId = String(createRes.data.policy._id);

  await makeRequest(baseUrl, `/api/policies/${policyId}/submit-review`, adminToken, { method: 'POST' });
  await makeRequest(baseUrl, `/api/policies/${policyId}/approve-publish`, adminToken, { method: 'POST' });

  const ackRes = await makeRequest(baseUrl, `/api/policies/${policyId}/ack`, userAToken, {
    method: 'POST',
    body: { note: 'Acknowledged' }
  });
  assert.equal(ackRes.status, 200);

  const dashboardRes = await makeRequest(baseUrl, '/api/policies/dashboard/read-receipts', adminToken);
  assert.equal(dashboardRes.status, 200);
  const row = dashboardRes.data.readReceipts.find((item) => String(item.policyId) === policyId);
  assert.ok(row);
  assert.equal(row.acknowledgedCount, 1);
  assert.equal(row.pendingCount, 2);
  assert.ok(row.pendingUsers.some((u) => u.email === 'dspb@example.com'));
});

test('org isolation prevents cross-org policy access', async () => {
  const orgA = new mongoose.Types.ObjectId();
  const orgB = new mongoose.Types.ObjectId();

  const adminA = await User.create({
    orgId: orgA,
    fullName: 'Admin A',
    email: 'admina@example.com',
    passwordHash: 'x',
    role: 'org_admin',
    status: 'active',
    customPermissions: ['policies:create', 'policies:submit_review', 'policies:approve', 'policies:read']
  });

  const adminB = await User.create({
    orgId: orgB,
    fullName: 'Admin B',
    email: 'adminb@example.com',
    passwordHash: 'x',
    role: 'org_admin',
    status: 'active',
    customPermissions: ['policies:read']
  });

  const tokenA = signToken(adminA);
  const tokenB = signToken(adminB);

  const createRes = await makeRequest(baseUrl, '/api/policies', tokenA, {
    method: 'POST',
    body: { title: 'Cross Org Isolation SOP', incidentTypes: ['safety-hazard'] }
  });
  const policyId = String(createRes.data.policy._id);

  await makeRequest(baseUrl, `/api/policies/${policyId}/submit-review`, tokenA, { method: 'POST' });
  await makeRequest(baseUrl, `/api/policies/${policyId}/approve-publish`, tokenA, { method: 'POST' });

  const accessRes = await makeRequest(baseUrl, `/api/policies/${policyId}`, tokenB);
  assert.equal(accessRes.status, 404);

  const dbPolicy = await PolicyDocument.findOne({ _id: policyId, orgId: orgA }).lean();
  assert.ok(dbPolicy);
});
