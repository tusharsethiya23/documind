import { Router } from 'express';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { vectorIndexStatus } from '../services/vectorSearch.js';

const router = Router();

router.get('/', async (_req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;
  const vectorIndex = dbConnected ? await vectorIndexStatus().catch(() => null) : null;
  res.status(dbConnected ? 200 : 503).json({
    status: dbConnected ? 'ok' : 'degraded',
    database: dbConnected ? 'connected' : 'disconnected',
    vectorIndex: vectorIndex ?? 'missing',
    llmProvider: config.llmProvider,
  });
});

export default router;
