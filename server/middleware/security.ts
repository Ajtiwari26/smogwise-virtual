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

/**
 * Per-route 15-minute request limits.
 * Note: On Vercel serverless functions, rate-limit counters reside in per-instance
 * memory and reset across cold starts or concurrent lambda isolates.
 */
export const RATE_LIMITS = {
  HEALTH: 60,
  GEO: 60,
  PLAN: 120,
  AI_ASK: 40,
  BRIEFING: 40,
} as const;

const DEFAULT_DEV_ORIGINS: readonly string[] = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const VERCEL_HOST_REGEX = /^[a-z0-9.-]+$/;
const IPV4_REGEX = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function toVercelHttpsOrigin(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const host = raw.trim().toLowerCase();
  const isValidHost =
    VERCEL_HOST_REGEX.test(host) &&
    host !== 'localhost' &&
    host.includes('.') &&
    !IPV4_REGEX.test(host);
  return isValidHost ? `https://${host}` : null;
}

function buildAllowedOrigins(): ReadonlySet<string> {
  const { allowedOrigin } = getEnvConfig();
  const origins = new Set<string>(DEFAULT_DEV_ORIGINS);
  for (const entry of allowedOrigin.split(',')) {
    const trimmed = entry.trim();
    if (trimmed.length > 0 && trimmed !== '*') {
      origins.add(trimmed);
    }
  }
  const vercelHosts = [
    process.env['VERCEL_PROJECT_PRODUCTION_URL'],
    process.env['VERCEL_BRANCH_URL'],
    process.env['VERCEL_URL'],
  ];
  for (const rawHost of vercelHosts) {
    const origin = toVercelHttpsOrigin(rawHost);
    if (origin !== null) {
      origins.add(origin);
    }
  }
  return origins;
}

/**
 * Creates Helmet middleware with strict CSP, isolation headers, and nosniff.
 */
export function createHelmetMiddleware(): RequestHandler {
  const isProd = process.env['NODE_ENV'] === 'production';
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    frameguard: { action: 'deny' },
    xContentTypeOptions: true,
  });
}

/**
 * Sets Permissions-Policy header restricting sensitive browser hardware APIs.
 */
export function createPermissionsPolicyMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
    );
    next();
  };
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
  readonly briefingLimiter: RequestHandler;
} {
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
    aiAskLimiter: makeLimiter(
      RATE_LIMITS.AI_ASK,
      'Too many assistant requests. Try again later.',
    ),
    briefingLimiter: makeLimiter(
      RATE_LIMITS.BRIEFING,
      'Too many briefing requests. Try again later.',
    ),
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
      details: err.issues.slice(0, 5).map((issue) => ({
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
