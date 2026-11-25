/**
 * Express security middleware: Helmet CSP, strict CORS allowlist,
 * route-isolated rate limiters, 16KB JSON body cap, and sanitized error handler.
 */

import cors from 'cors';
import type { CorsOptions } from 'cors';
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { getEnvConfig } from '../config/env.js';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const DEFAULT_DEV_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function buildAllowedOrigins(): ReadonlySet<string> {
  const { allowedOrigin } = getEnvConfig();
  const origins = new Set<string>(DEFAULT_DEV_ORIGINS);
  for (const entry of allowedOrigin.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length > 0 && trimmed !== '*') {
      origins.add(trimmed);
    }
  }
  return origins;
}

/**
 * Creates Helmet middleware with strict CSP, X-Frame-Options: DENY, and nosniff.
 */
export function createHelmetMiddleware(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    xContentTypeOptions: true,
  });
}

/**
 * Creates strict CORS middleware that only permits explicitly allowlisted origins.
 */
export function createCorsMiddleware(): RequestHandler {
  const allowed = buildAllowedOrigins();
  const options: CorsOptions = {
    origin: (origin, callback) => {
      if (origin === undefined || allowed.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
  return cors(options);
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
    message: { error: message },
  });
}

/**
 * Creates isolated rate limiters so /api/health bursts never starve plan or AI routes.
 */
export function createRouteLimiters(): {
  readonly healthLimiter: RequestHandler;
  readonly geoLimiter: RequestHandler;
  readonly planLimiter: RequestHandler;
  readonly aiAskLimiter: RequestHandler;
} {
  return {
    healthLimiter: makeLimiter(60, 'Too many health check requests. Try again later.'),
    geoLimiter: makeLimiter(60, 'Too many location search requests. Please slow down.'),
    planLimiter: makeLimiter(120, 'Too many plan requests. Try again later.'),
    aiAskLimiter: makeLimiter(40, 'Too many assistant requests. Try again later.'),
  };
}

interface HttpErrorLike {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly statusCode?: unknown;
}

function isPayloadTooLarge(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const e = err as HttpErrorLike;
  return e.type === 'entity.too.large' || e.status === 413 || e.statusCode === 413;
}

function isMalformedJsonError(err: unknown): boolean {
  if (err instanceof SyntaxError) {
    return true;
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as HttpErrorLike;
    return e.type === 'entity.parse.failed' || e.status === 400;
  }
  return false;
}

/**
 * Centralized JSON error handler that never exposes stack traces or internal paths.
 */
export const centralizedErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (isPayloadTooLarge(err)) {
    res.status(413).json({ error: 'Request payload exceeds the 16KB limit.' });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed.',
      details: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }
  if (isMalformedJsonError(err)) {
    res.status(400).json({ error: 'Malformed JSON request body.' });
    return;
  }
  res.status(500).json({ error: 'Internal server error.' });
};
