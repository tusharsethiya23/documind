import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { searchIndexStatus } from '../services/search.js';

const router = Router();

router.get('/', async (_req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const indexes = dbConnected ? await searchIndexStatus().catch(() => null) : null;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    vectorIndex: indexes?.vector ?? 'missing',
    textIndex: indexes?.text ?? 'missing',
    searchMode: config.searchMode,
    llmProvider: config.llmProvider,
  });
});

export default router;
