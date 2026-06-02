// Usage: node scripts/add_super_admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Organization = require('../src/models/Organization');

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- update to your DB name if needed

async function main() {
  await mongoose.connect(MONGO_URI);

  // Find your main org (update query if needed)
  const org = await Organization.findOne({});
  if (!org) throw new Error('No organization found!');

  const email = 'Aginnis@threshold75.com';
  const fullName = 'A. Ginnis';
  const password = 'SuperSecurePassword!2026'; // <-- change this and send to your user
  const passwordHash = await bcrypt.hash(password, 10);

  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    user.role = 'super_admin';
    user.orgId = org._id;
    user.passwordHash = passwordHash;
    user.status = 'active';
    await user.save();
    console.log('Updated existing user to super_admin:', email);
  } else {
    user = await User.create({
      orgId: org._id,
      fullName,
      email: email.toLowerCase(),
      passwordHash,
      role: 'super_admin',
      status: 'active'
    });
    console.log('Created new super_admin user:', email);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
