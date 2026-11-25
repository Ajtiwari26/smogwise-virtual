/**
 * Local HTTP server entrypoint for SmogWise Virtual API.
 */

import { createApp } from './app.js';
import { getEnvConfig } from './config/env.js';

/**
 * Starts the local Express HTTP server on the configured port.
 */
export function startServer(): void {
  const { port, nodeEnv } = getEnvConfig();
  const app = createApp();
  app.listen(port, () => {
    process.stdout.write(
      `SmogWise Virtual API listening on http://localhost:${String(port)} (${nodeEnv})\n`,
    );
  });
}

startServer();
