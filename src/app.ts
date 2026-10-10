import cors from 'cors';
import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { initializeDatabase } from './database/db';
import { logger } from './logger';
import { requireHermesGroup } from './middleware/hermesGroupAccess';
import { consultationRouter } from './routes/consultations';
import { customerRouter } from './routes/customers';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 8080);

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    logger.info({ method: req.method, path: req.originalUrl, statusCode: res.statusCode, durationMs: Date.now() - startedAt }, 'Request completed');
  });
  next();
});

app.get('/health', async (_req, res, next) => {
  try {
    await initializeDatabase();
    res.json({ status: 'ok', backend: 'vercel-neon' });
  } catch (error) {
    next(error);
  }
});

app.use('/api', requireHermesGroup);
app.use('/api/customers', customerRouter);
app.use('/api/consultations', consultationRouter);

app.use((_req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: 'Invalid request', details: error.flatten() });
  }

  const message = error instanceof Error ? error.message : 'Unexpected server error';
  logger.error({ error: message }, 'Request failed');
  return res.status(500).json({ error: 'Internal server error' });
});

if (!process.env.VERCEL) {
  app.listen(port, () => logger.info({ port }, 'Server started'));
}

export default app;
