import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import askRouter from './routes/ask.js';
import documentsRouter from './routes/documents.js';
import healthRouter from './routes/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Hugging Face, Render, nginx), trust X-Forwarded-For
  // so rate limiting sees the visitor's IP rather than the proxy's.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/documents', documentsRouter);
  app.use(
    '/api/ask',
    rateLimit({
      windowMs: 10 * 60 * 1000,
      max: config.askLimitPer10Min,
      message: 'Too many questions from your connection (the demo runs on a free LLM quota).',
    }),
    askRouter,
  );

  app.use('/api', notFound);

  // In production, serve the built React app from the same server (one container, one URL).
  if (config.clientDist && fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use(express.static(config.clientDist, { index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
