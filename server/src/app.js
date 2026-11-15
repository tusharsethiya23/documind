import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { errorHandler, notFound } from './middleware/errors.js';
import askRouter from './routes/ask.js';
import documentsRouter from './routes/documents.js';
import healthRouter from './routes/health.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.clientOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.use('/api/health', healthRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/ask', askRouter);

  app.use('/api', notFound);
  app.use(errorHandler);
  return app;
}
