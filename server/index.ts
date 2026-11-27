/**
 * Local HTTP server entrypoint for SmogWise Virtual API with timeouts and graceful shutdown.
 */

import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { getEnvConfig } from './config/env.js';

const REQUEST_TIMEOUT_MS = 30_000;
const HEADERS_TIMEOUT_MS = 10_000;
const KEEP_ALIVE_TIMEOUT_MS = 5_000;

function attachShutdownHandlers(server: Server): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) {
      return;
    }
    closing = true;
    process.stdout.write(`Received ${signal}; shutting down SmogWise API server...\n`);
    server.close(() => {
      process.exit(0);
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Starts the local Express HTTP server on the configured port.
 */
export function startServer(): Server {
  const { port, nodeEnv } = getEnvConfig();
  const app = createApp();
  const server = app.listen(port, () => {
    process.stdout.write(
      `SmogWise Virtual API listening on http://localhost:${String(port)} (${nodeEnv})\n`,
    );
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  attachShutdownHandlers(server);
  return server;
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  startServer();
}
