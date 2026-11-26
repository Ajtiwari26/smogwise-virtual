/**
 * Authentication and protected user-preferences routes for SmogWise Virtual.
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import type { PublicUser } from '../config/authAccounts.js';
import { getEnvConfig } from '../config/env.js';
import { LoginSchema, UserProfileSchema } from '../middleware/promptGuard.js';
import { requireAuth, type AuthenticatedRequest } from '../middleware/requireAuth.js';
import {
  buildClearSessionCookie,
  buildSessionCookie,
  extractSessionToken,
  signSessionToken,
  verifyCredentials,
  verifySessionToken,
} from '../services/authService.js';
import { getUserPreferences, setUserPreferences } from '../services/preferencesStore.js';
import { extractProfilePayload, toUserProfile } from './apiRouteHelpers.js';

const NO_STORE_CACHE_CONTROL = 'private, no-store';

function getAuthUser(req: Request): PublicUser | undefined {
  return (req as AuthenticatedRequest).authUser;
}

function handleLogin(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  try {
    const parsed = LoginSchema.parse(req.body);
    const user = verifyCredentials(parsed.email, parsed.password);
    if (user === null) {
      res.status(401).json({
        error: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password.',
      });
      return;
    }
    const token = signSessionToken(user);
    const isProd = getEnvConfig().nodeEnv === 'production';
    res.setHeader('Set-Cookie', buildSessionCookie(token, isProd));
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

function handleLogout(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const isProd = getEnvConfig().nodeEnv === 'production';
  res.setHeader('Set-Cookie', buildClearSessionCookie(isProd));
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

function handleGetPreferences(req: Request, res: Response): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = getAuthUser(req);
  if (authUser === undefined) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }
  res.status(200).json({ profile: getUserPreferences(authUser.id) ?? null });
}

function handlePutPreferences(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  const authUser = getAuthUser(req);
  if (authUser === undefined) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }
  try {
    const parsed = UserProfileSchema.parse(extractProfilePayload(req.body));
    const profile = toUserProfile(parsed);
    setUserPreferences(authUser.id, profile);
    res.status(200).json({ profile });
  } catch (err) {
    next(err);
  }
}

/** Creates the Express router handling authentication and protected user preferences. */
export function createAuthRouter(
  authLimiter: RequestHandler,
  sessionLimiter: RequestHandler = authLimiter,
): Router {
  const router = express.Router();

  router.post('/auth/login', authLimiter, handleLogin);
  router.post('/auth/logout', authLimiter, handleLogout);
  router.get('/auth/session', sessionLimiter, handleSession);
  router.get('/user/preferences', sessionLimiter, requireAuth, handleGetPreferences);
  router.put('/user/preferences', sessionLimiter, requireAuth, handlePutPreferences);

  return router;
}
