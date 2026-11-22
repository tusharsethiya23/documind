import { createApp } from './app.js';
import { config } from './config.js';
import { connectDB, disconnectDB } from './db.js';
import { failInterruptedDocuments } from './services/indexer.js';
import { ensureSearchIndexes } from './services/search.js';

try {
  await connectDB();
} catch (err) {
  console.error(`Could not connect to MongoDB: ${err.message}`);
  process.exit(1);
}
console.log('Connected to MongoDB');

const interrupted = await failInterruptedDocuments();
if (interrupted) console.log(`Marked ${interrupted} interrupted upload(s) as failed`);

const created = await ensureSearchIndexes().catch((err) => {
  console.warn(`Could not check the search indexes: ${err.message}`);
  return [];
});
if (created.length) console.log(`Created ${created.join(', ')}; they become queryable in about a minute`);

const server = createApp().listen(config.port, () => {
  console.log(`DocuMind API on http://localhost:${config.port}`);
});

const shutdown = async () => {
  server.close();
  await disconnectDB();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
