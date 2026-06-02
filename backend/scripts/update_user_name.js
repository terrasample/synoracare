// Usage: node scripts/update_user_name.js
const mongoose = require('mongoose');
const User = require('../src/models/User');

const MONGO_URI = 'mongodb://localhost:27017/YOUR_DB_NAME'; // <-- update to your DB name if needed

async function main() {
  await mongoose.connect(MONGO_URI);
  const email = 'aginnis@threshold75.com';
  const fullName = 'Drew';
  const user = await User.findOneAndUpdate(
    { email: email.toLowerCase() },
    { $set: { fullName } },
    { new: true }
  );
  if (user) {
    console.log('Updated user name:', user);
  } else {
    console.log('User not found.');
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
