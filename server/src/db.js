import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!config.mongoUri) {
    throw new Error('MONGODB_URI is not set. Copy server/.env.example to server/.env and add your Atlas connection string.');
  }
  await mongoose.connect(config.mongoUri, { dbName: config.dbName, serverSelectionTimeoutMS: 10000 });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
