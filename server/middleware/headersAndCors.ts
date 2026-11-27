/**
 * HTTP security headers, strict CORS allowlist, Vary: Origin, and Cache-Control defaults.
 */

import cors from 'cors';
import type { CorsOptions } from 'cors';
import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { getEnvConfig } from '../config/env.js';

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

/** Builds the set of explicitly trusted CORS and mutation origins. */
export function buildAllowedOrigins(): ReadonlySet<string> {
  const { allowedOrigin, nodeEnv } = getEnvConfig();
  const origins = new Set<string>(nodeEnv !== 'production' ? DEFAULT_DEV_ORIGINS : []);
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
 * Creates Helmet middleware aligned with vercel.json CSP, isolation headers, and HSTS.
 */
export function createHelmetMiddleware(): RequestHandler {
  const isProd = process.env['NODE_ENV'] === 'production';
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'none'"],
        styleSrc: isProd ? ["'self'"] : ["'self'", "'unsafe-inline'"],
        styleSrcAttr: ["'none'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        workerSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        ...(isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: isProd
      ? { maxAge: 63072000, includeSubDomains: true, preload: true }
      : false,
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
 * Sets default `Cache-Control: private, no-store` before routes and limiters.
 */
export function createDefaultNoStoreMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  };
}

/**
 * Unconditionally adds `Vary: Origin` so caches never mix CORS responses across origins.
 */
export function createVaryOriginMiddleware(): RequestHandler {
  return (_req, res, next) => {
    res.vary('Origin');
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
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204,
  };
  return cors(options);
}
