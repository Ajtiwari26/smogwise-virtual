/**
 * Express security middleware: CSRF Origin guard, route-isolated rate limiters,
 * 16KB JSON body cap, and sanitized error handler. Re-exports header & CORS middleware.
 */

import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import { logServerEvent } from '../config/logger.js';
import { buildAllowedOrigins } from './headersAndCors.js';

/** Re-exported strict CORS allowlist middleware. */
export { createCorsMiddleware } from './headersAndCors.js';
/** Re-exported default `private, no-store` Cache-Control middleware. */
export { createDefaultNoStoreMiddleware } from './headersAndCors.js';
/** Re-exported Helmet CSP and HSTS security middleware. */
export { createHelmetMiddleware } from './headersAndCors.js';
/** Re-exported hardware Permissions-Policy header middleware. */
export { createPermissionsPolicyMiddleware } from './headersAndCors.js';
/** Re-exported unconditional `Vary: Origin` middleware. */
export { createVaryOriginMiddleware } from './headersAndCors.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const RATE_LIMITS = {
  HEALTH: 60,
  GEO: 60,
  PLAN: 120,
  SESSION: 120,
  AI_ASK: 40,
  BRIEFING: 40,
  AUTH: 20,
} as const;

const SAFE_HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

function hasCrossSiteFetchMetadata(fetchSite: string | string[] | undefined): boolean {
  if (fetchSite === undefined) {
    return false;
  }
  const raw = Array.isArray(fetchSite) ? fetchSite.join(',') : fetchSite;
  return raw
    .toLowerCase()
    .split(',')
    .some((part) => part.trim() === 'cross-site');
}

function evaluateCrossSiteMutation(
  fetchSite: string | string[] | undefined,
  origin: string | string[] | undefined,
  allowedOrigins: ReadonlySet<string>,
): { readonly blocked: boolean; readonly code: string; readonly message: string } {
  if (hasCrossSiteFetchMetadata(fetchSite)) {
    return {
      blocked: true,
      code: 'FORBIDDEN_CROSS_SITE',
      message: 'Cross-site mutation rejected.',
    };
  }
  if (origin !== undefined && (typeof origin !== 'string' || !allowedOrigins.has(origin))) {
    return {
      blocked: true,
      code: 'FORBIDDEN_ORIGIN',
      message: 'Untrusted request origin.',
    };
  }
  return { blocked: false, code: '', message: '' };
}

/**
 * Rejects cross-site browser mutations via Fetch Metadata and strict Origin checks.
 */
export function createCsrfOriginGuard(): RequestHandler {
  const allowedOrigins = buildAllowedOrigins();
  return (req, res, next) => {
    if (SAFE_HTTP_METHODS.has(req.method)) {
      next();
      return;
    }
    const verdict = evaluateCrossSiteMutation(
      req.headers['sec-fetch-site'],
      req.headers.origin,
      allowedOrigins,
    );
    if (verdict.blocked) {
      res.setHeader('Cache-Control', 'private, no-store');
      res.status(403).json({ error: verdict.code, message: verdict.message });
      return;
    }
    next();
  };
}

/**
 * Creates JSON body parser capped at 16KB to prevent payload abuse.
 */
export function createJsonBodyParser(): RequestHandler {
  return express.json({ limit: '16kb' });
}

function makeLimiter(max: number, message: string): RequestHandler {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES_MS,
    max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'RATE_LIMITED', message },
  });
}

/** Isolated rate limiters returned by createRouteLimiters. */
export interface RouteLimiters {
  readonly healthLimiter: RequestHandler;
  readonly geoLimiter: RequestHandler;
  readonly planLimiter: RequestHandler;
  readonly sessionLimiter: RequestHandler;
  readonly aiAskLimiter: RequestHandler;
  readonly briefingLimiter: RequestHandler;
  readonly authLimiter: RequestHandler;
}

/**
 * Creates isolated rate limiters so /api/health bursts never starve plan or AI routes.
 */
export function createRouteLimiters(): RouteLimiters {
  return {
    healthLimiter: makeLimiter(
      RATE_LIMITS.HEALTH,
      'Too many health check requests. Try again later.',
    ),
    geoLimiter: makeLimiter(
      RATE_LIMITS.GEO,
      'Too many location search requests. Please slow down.',
    ),
    planLimiter: makeLimiter(RATE_LIMITS.PLAN, 'Too many plan requests. Try again later.'),
    sessionLimiter: makeLimiter(
      RATE_LIMITS.SESSION,
      'Too many session requests. Try again later.',
    ),
    aiAskLimiter: makeLimiter(
      RATE_LIMITS.AI_ASK,
      'Too many assistant requests. Try again later.',
    ),
    briefingLimiter: makeLimiter(
      RATE_LIMITS.BRIEFING,
      'Too many briefing requests. Try again later.',
    ),
    authLimiter: makeLimiter(
      RATE_LIMITS.AUTH,
      'Too many login attempts. Try again later.',
    ),
  };
}

function isPayloadTooLarge(err: unknown): boolean {
  if (!isPlainRecord(err)) {
    return false;
  }
  return err['type'] === 'entity.too.large' || err['status'] === 413 || err['statusCode'] === 413;
}

function isMalformedJsonError(err: unknown): boolean {
  if (!isPlainRecord(err)) {
    return false;
  }
  if (err['type'] === 'entity.parse.failed') {
    return true;
  }
  return (
    err instanceof SyntaxError &&
    ('body' in err || err['status'] === 400 || err['statusCode'] === 400)
  );
}

/**
 * Centralized JSON error handler that never exposes stack traces or internal paths.
 */
export const centralizedErrorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.setHeader('Cache-Control', 'private, no-store');
  if (isPayloadTooLarge(err)) {
    res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'Request payload exceeds the 16KB limit.',
    });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Validation failed.',
      details: err.issues.slice(0, 5).map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  if (isMalformedJsonError(err)) {
    res.status(400).json({
      error: 'MALFORMED_JSON',
      message: 'Malformed JSON request body.',
    });
    return;
  }
  logServerEvent('error', 'api_unhandled_error', {
    method: req.method,
    path: req.path,
    errorName: err instanceof Error ? err.name : 'UnknownError',
  });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error.' });
};
