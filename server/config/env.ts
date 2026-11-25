/**
 * Server-only environment configuration loader.
 * Loads dotenv once and exposes typed runtime settings without leaking secrets.
 */

import dotenv from 'dotenv';
dotenv.config({ override: true });

/** Typed server environment configuration. */
export interface EnvConfig {
  readonly port: number;
  readonly allowedOrigin: string;
  readonly geminiApiKey: string;
  readonly nodeEnv: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173';

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return DEFAULT_PORT;
  }
  return parsed;
}

/**
 * Returns validated server environment configuration from process.env.
 */
export function getEnvConfig(): EnvConfig {
  const port = parsePort(process.env['PORT']);
  const rawOrigin = process.env['ALLOWED_ORIGIN']?.trim();
  const allowedOrigin =
    rawOrigin !== undefined && rawOrigin.length > 0 ? rawOrigin : DEFAULT_ALLOWED_ORIGIN;
  const geminiApiKey = process.env['GEMINI_API_KEY']?.trim() ?? '';
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';

  return {
    port,
    allowedOrigin,
    geminiApiKey,
    nodeEnv,
  };
}
