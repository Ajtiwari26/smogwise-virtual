/**
 * Authentication and protected user-preferences routes for SmogWise Virtual.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { type PublicUser } from '../config/authAccounts.js';
import { getEnvConfig, isSessionSigningConfigured } from '../config/env.js';
import { LoginSchema } from '../middleware/requestSchemas.js';
import {
  getAuthenticatedSessionJti,
  getAuthenticatedUser,
  requireAuth,
} from '../middleware/requireAuth.js';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  extractSessionToken,
  revokeSessionToken,
  signSessionToken,
  verifyCredentialsAsync,
  verifySessionToken,
} from '../services/authService.js';
import {
  buildClearPreferencesCookie,
  buildPreferencesCookie,
  getUserPreferencesRecord,
  newerPreferencesRecord,
  readPreferencesCookieRecord,
  resolvePreferenceScopeKey,
  saveUserPreferencesVersioned,
  setUserPreferences,
} from '../services/preferencesStore.js';
import { parsePreferencesSaveInput, wrapAsyncRoute } from './apiRouteHelpers.js';

const NO_STORE_CACHE_CONTROL = 'private, no-store';

function shouldUseSecureCookie(req: Request): boolean {
  return getEnvConfig().nodeEnv === 'production' || req.secure;
}

async function handleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  try {
    const parsed = LoginSchema.parse(req.body);
    const user = await verifyCredentialsAsync(parsed.email, parsed.password);
    if (user === null) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
      return;
    }
    const token = signSessionToken(user);
    res.setHeader('Set-Cookie', buildSessionCookie(token, shouldUseSecureCookie(req)));
    res.status(200).json({ user });
  } catch (err: unknown) {
    next(err);
  }
}

function handleLogout(req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const token = extractSessionToken(req.headers.cookie, req.headers.authorization);
  if (token !== undefined) {
    revokeSessionToken(token);
  }
  const isSecure = shouldUseSecureCookie(req);
  res.setHeader('Set-Cookie', [
    buildClearSessionCookie(isSecure),
    buildClearPreferencesCookie(isSecure),
  ]);
  res.status(200).json({ ok: true });
}

function handleSession(req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const token = extractSessionToken(req.headers.cookie, req.headers.authorization);
  if (token !== undefined) {
    const user = verifySessionToken(token);
    if (user !== null) {
      res.status(200).json({ authenticated: true, user });
      return;
    }
  }
  res.status(200).json({ authenticated: false, user: null });
}

function requireAuthUser(res: Response): PublicUser | undefined {
  const authUser = getAuthenticatedUser(res);
  if (authUser === undefined) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return undefined;
  }
  return authUser;
}

function resolveExpectedVersion(header: string | string[] | undefined, body?: number) {
  if (header === undefined) {
    return body === undefined ? ({ ok: false } as const) : ({ ok: true, version: body } as const);
  }
  const match = typeof header === 'string' ? /^"v(0|[1-9]\d*)"$/.exec(header) : null;
  if (match === null) return { ok: false } as const;
  const version = Number(match[1]);
  if (!Number.isSafeInteger(version) || (body !== undefined && version !== body)) {
    return { ok: false } as const;
  }
  return { ok: true, version } as const;
}

function handleGetPreferences(req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = requireAuthUser(res);
  if (authUser === undefined) return;
  const scopeKey = resolvePreferenceScopeKey(authUser.id, getAuthenticatedSessionJti(res));
  const cached = getUserPreferencesRecord(scopeKey);
  const signed = readPreferencesCookieRecord(req.headers.cookie, scopeKey);
  const current = newerPreferencesRecord(cached, signed);
  if (current !== undefined && current !== cached) {
    setUserPreferences(scopeKey, current.profile, current.version);
  }
  res.setHeader('ETag', `"v${current?.version ?? 0}"`);
  res.status(200).json({ profile: current?.profile ?? null });
}

function handlePutPreferences(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = requireAuthUser(res);
  if (authUser === undefined) return;
  try {
    const { profile, expectedVersion: bodyVersion } = parsePreferencesSaveInput(req.body);
    const expected = resolveExpectedVersion(req.headers['if-match'], bodyVersion);
    if (!expected.ok) {
      res.status(400).json({
        error: 'INVALID_IF_MATCH',
        message: 'Use the exact strong preference ETag returned by the server.',
      });
      return;
    }
    const scopeKey = resolvePreferenceScopeKey(authUser.id, getAuthenticatedSessionJti(res));
    const cookieRecord = readPreferencesCookieRecord(req.headers.cookie, scopeKey);
    const saved = saveUserPreferencesVersioned(scopeKey, profile, expected.version, cookieRecord);
    if (!saved.ok) {
      res.setHeader('ETag', `"v${String(saved.currentVersion)}"`);
      res.status(409).json({
        error: 'PREFS_CONFLICT',
        message: 'Preferences were updated by another request. Reload to continue.',
      });
      return;
    }
    const isSecure = shouldUseSecureCookie(req);
    const cookieHeader = buildPreferencesCookie(scopeKey, saved.profile, isSecure, saved.version);
    if (cookieHeader !== undefined) res.setHeader('Set-Cookie', cookieHeader);
    res.setHeader('ETag', `"v${String(saved.version)}"`);
    res.status(200).json({ profile: saved.profile });
  } catch (err: unknown) {
    next(err);
  }
}

const requireSigningConfig: RequestHandler = (_req, res, next) => {
  if (isSessionSigningConfigured()) {
    next();
    return;
  }
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  res.status(503).json({
    error: 'AUTH_UNAVAILABLE',
    message: 'Sign-in and preferences are temporarily unavailable.',
  });
};

/** Creates the Express router handling authentication and protected user preferences. */
export function createAuthRouter(
  authLimiter: RequestHandler,
  sessionLimiter: RequestHandler = authLimiter,
): Router {
  const router = express.Router();

  router.use(['/auth', '/user/preferences'], requireSigningConfig);
  router.post('/auth/login', authLimiter, wrapAsyncRoute(handleLogin));
  router.post('/auth/logout', sessionLimiter, handleLogout);
  router.get('/auth/session', sessionLimiter, handleSession);
  router.get('/user/preferences', sessionLimiter, requireAuth, handleGetPreferences);
  router.put('/user/preferences', sessionLimiter, requireAuth, handlePutPreferences);

  return router;
}
