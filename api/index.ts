/**
 * Vercel serverless function adapter wrapping the Express application.
 */

import type { Express } from 'express';
import { createApp } from '../server/app.js';

/** Pre-configured Express application exported for Vercel serverless runtime. */
const app: Express = createApp();

/** Default Vercel serverless Express application handler export. */
export default app;
