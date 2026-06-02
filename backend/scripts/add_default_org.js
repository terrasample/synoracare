// Usage: node scripts/add_default_org.js
const mongoose = require('mongoose');
const Organization = require('../src/models/Organization');

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- update to your DB name if needed

async function main() {
  await mongoose.connect(MONGO_URI);

  const org = await Organization.create({
    name: 'Default Organization',
    slug: 'default-org',
    stateCode: 'NY'
  });
  console.log('Created organization:', org);
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
