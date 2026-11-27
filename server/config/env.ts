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
  readonly trustProxy: boolean;
}

const DEFAULT_PORT = 3001;
const DEFAULT_ALLOWED_ORIGIN = 'http://localhost:5173';
const MIN_AUTH_SECRET_LENGTH = 32;
const FALLBACK_AUTH_SECRET = crypto.randomBytes(32).toString('hex');
let warnedEphemeralSecret = false;

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

function resolveAuthSecret(raw: string | undefined, nodeEnv: string): string {
  const trimmed = raw?.trim();
  if (trimmed !== undefined && trimmed.length >= MIN_AUTH_SECRET_LENGTH) {
    return trimmed;
  }
  if (nodeEnv === 'production' && !warnedEphemeralSecret) {
    warnedEphemeralSecret = true;
    process.emitWarning(
      'AUTH_SECRET is unset or shorter than 32 characters in production; using an ephemeral per-process secret.',
      'SecurityWarning',
    );
  }
  return FALLBACK_AUTH_SECRET;
}

function resolveAllowedOrigin(rawOrigin: string | undefined, nodeEnv: string): string {
  const trimmed = rawOrigin?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  return nodeEnv === 'production' ? '' : DEFAULT_ALLOWED_ORIGIN;
}

function resolveTrustProxy(env: NodeJS.ProcessEnv): boolean {
  return env['TRUST_PROXY']?.trim() === '1' || env['VERCEL']?.trim() === '1';
}

/**
 * Returns validated server environment configuration from process.env.
 */
export function getEnvConfig(): EnvConfig {
  const nodeEnv = process.env['NODE_ENV']?.trim() || 'development';
  return {
    port: parsePort(process.env['PORT']),
    allowedOrigin: resolveAllowedOrigin(process.env['ALLOWED_ORIGIN'], nodeEnv),
    geminiApiKey: process.env['GEMINI_API_KEY']?.trim() ?? '',
    nodeEnv,
    authSecret: resolveAuthSecret(process.env['AUTH_SECRET'], nodeEnv),
    trustProxy: resolveTrustProxy(process.env),
  };
}
