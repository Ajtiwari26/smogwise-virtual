/**
 * Server-only environment configuration loader.
 * Loads dotenv once and exposes typed runtime settings without leaking secrets.
 */

import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

/** Typed server environment configuration. */
export interface EnvConfig {
  readonly port: number;
  readonly allowedOrigin: string;
  readonly geminiApiKey: string;
  readonly nodeEnv: string;
  readonly authSecret: string;
}

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173';
const MIN_AUTH_SECRET_LENGTH = 16;
const FALLBACK_AUTH_SECRET = crypto.randomBytes(32).toString('hex');

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

function resolveAuthSecret(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (trimmed !== undefined && trimmed.length >= MIN_AUTH_SECRET_LENGTH) {
    return trimmed;
  }
  return FALLBACK_AUTH_SECRET;
}

/**
 * Returns validated server environment configuration from process.env.
 */
export function getEnvConfig(): EnvConfig {
  const port = parsePort(process.env['PORT']);
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';
  const fallbackOrigin = nodeEnv === 'production' ? '' : DEFAULT_ALLOWED_ORIGIN;
  const rawOrigin = process.env['ALLOWED_ORIGIN']?.trim();
  const allowedOrigin =
    rawOrigin !== undefined && rawOrigin.length > 0 ? rawOrigin : fallbackOrigin;
  const geminiApiKey = process.env['GEMINI_API_KEY']?.trim() ?? '';
  const authSecret = resolveAuthSecret(process.env['AUTH_SECRET']);

  return {
    port,
    allowedOrigin,
    geminiApiKey,
    nodeEnv,
    authSecret,
  };
}
