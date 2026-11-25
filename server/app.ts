/**
 * Express application factory for SmogWise Virtual.
 * Exported for local dev, Vercel serverless adapter, and ephemeral test probes.
 */

import express from 'express';
import type { Express, Request, Response } from 'express';
import {
  centralizedErrorHandler,
  createCorsMiddleware,
  createHelmetMiddleware,
  createJsonBodyParser,
} from './middleware/security.js';
import { createApiRouter } from './routes/apiRoutes.js';

function handleNotFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found.' });
}

/**
 * Creates and configures a hardened Express application instance.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(createHelmetMiddleware());
  app.use(createCorsMiddleware());
  app.use(createJsonBodyParser());

  app.use('/api', createApiRouter());
  app.use(handleNotFound);
  app.use(centralizedErrorHandler);

  return app;
}

/** Default pre-configured Express app instance. */
export const app: Express = createApp();
