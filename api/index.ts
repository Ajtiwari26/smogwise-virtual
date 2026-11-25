/**
 * Vercel serverless function adapter wrapping the Express application.
 */

import type { Express } from 'express';
import { createApp } from '../server/app.js';

/** Pre-configured Express application exported for Vercel serverless runtime. */
const app: Express = createApp();

export default app;
