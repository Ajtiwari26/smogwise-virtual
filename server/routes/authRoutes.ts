/**
 * Authentication and protected user-preferences routes for SmogWise Virtual.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { type PublicUser } from '../config/authAccounts.js';
import { getEnvConfig } from '../config/env.js';
import { LoginSchema } from '../middleware/requestSchemas.js';
import { getAuthenticatedUser, requireAuth } from '../middleware/requireAuth.js';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  extractSessionToken,
  revokeSessionToken,
  signSessionToken,
  verifyCredentialsAsync,
  verifySessionToken,
} from '../services/authService.js';
import { getUserPreferences, setUserPreferences } from '../services/preferencesStore.js';
import { parsePreferencesProfile, wrapAsyncRoute } from './apiRouteHelpers.js';

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
  res.setHeader('Set-Cookie', buildClearSessionCookie(shouldUseSecureCookie(req)));
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

function handleGetPreferences(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = requireAuthUser(res);
  if (authUser === undefined) {
    return;
  }
  res.status(200).json({ profile: getUserPreferences(authUser.id) ?? null });
}

function handlePutPreferences(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = requireAuthUser(res);
  if (authUser === undefined) {
    return;
  }
  try {
    const profile = parsePreferencesProfile(req.body);
    setUserPreferences(authUser.id, profile);
    res.status(200).json({ profile });
  } catch (err: unknown) {
    next(err);
  }
}

/** Creates the Express router handling authentication and protected user preferences. */
export function createAuthRouter(
  authLimiter: RequestHandler,
  sessionLimiter: RequestHandler = authLimiter,
): Router {
  const router = express.Router();

  router.post('/auth/login', authLimiter, wrapAsyncRoute(handleLogin));
  router.post('/auth/logout', sessionLimiter, handleLogout);
  router.get('/auth/session', sessionLimiter, handleSession);
  router.get('/user/preferences', sessionLimiter, requireAuth, handleGetPreferences);
  router.put('/user/preferences', sessionLimiter, requireAuth, handlePutPreferences);

  return router;
}
