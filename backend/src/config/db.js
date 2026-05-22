const mongoose = require('mongoose');
const env = require('./env');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryMongo = null;

async function connectDb() {
  try {
    await mongoose.connect(env.mongoUri);
    console.log('Connected to MongoDB:', env.mongoUri);
    return;
  } catch (error) {
    if (!env.allowInMemoryMongo) {
      throw error;
    }

    console.warn('Primary MongoDB unavailable, starting in-memory MongoDB for local development.');
    memoryMongo = await MongoMemoryServer.create();
    const memoryUri = memoryMongo.getUri();
    await mongoose.connect(memoryUri);
    console.log('Connected to in-memory MongoDB');
  }
}

module.exports = { connectDb };
