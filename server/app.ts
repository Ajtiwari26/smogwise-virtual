/**
 * Express application factory for SmogWise Virtual.
 * Exported for local dev, Vercel serverless adapter, and ephemeral test probes.
 */

import express from 'express';
import type { Express, Request, Response } from 'express';
import { getEnvConfig } from './config/env.js';
import { rejectPrototypePollutionAndDepth } from './middleware/bodyGuard.js';
import {
  centralizedErrorHandler,
  createCorsMiddleware,
  createCsrfOriginGuard,
  createDefaultNoStoreMiddleware,
  createHelmetMiddleware,
  createJsonBodyParser,
  createPermissionsPolicyMiddleware,
  createVaryOriginMiddleware,
} from './middleware/security.js';
import { createApiRouter } from './routes/apiRoutes.js';

function handleNotFound(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(404).json({ error: 'Not found.' });
}

/**
 * Creates and configures a hardened Express application instance.
 */
export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  if (getEnvConfig().trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(createDefaultNoStoreMiddleware());
  app.use(createHelmetMiddleware());
  app.use(createVaryOriginMiddleware());
  app.use(createCorsMiddleware());
  app.use(createCsrfOriginGuard());
  app.use(createJsonBodyParser());
  app.use(createPermissionsPolicyMiddleware());
  app.use(rejectPrototypePollutionAndDepth);

  app.use('/api', createApiRouter());
  app.use(handleNotFound);
  app.use(centralizedErrorHandler);

  return app;
}
