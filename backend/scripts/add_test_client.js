// Usage: node scripts/add_test_client.js
const mongoose = require('mongoose');
const Client = require('../src/models/Client');
const Organization = require('../src/models/Organization');

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- update to your DB name if needed

async function main() {
  await mongoose.connect(MONGO_URI);

  const org = await Organization.findOne({});
  if (!org) throw new Error('No organization found!');

  const client = await Client.create({
    orgId: org._id,
    displayName: 'Test Client',
    externalId: 'TC-001',
    locationId: null,
    status: 'active'
  });
  console.log('Created test client:', client);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
