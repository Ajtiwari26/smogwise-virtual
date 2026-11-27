/**
 * Express authentication middleware verifying signed session cookies or Bearer tokens.
 */

import type { NextFunction, Request, Response } from 'express';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import { LANGUAGE_CODES, PERSONA_TYPES } from '../../src/domain/types.js';
import type { PublicUser } from '../config/authAccounts.js';
import { extractSessionToken, verifySessionToken } from '../services/authService.js';

const AUTH_USER_LOCAL_KEY = 'authUser';

function isPublicUser(value: unknown): value is PublicUser {
  if (!isPlainRecord(value)) {
    return false;
  }
  return (
    typeof value['id'] === 'string' &&
    typeof value['email'] === 'string' &&
    typeof value['name'] === 'string' &&
    PERSONA_TYPES.some((persona) => persona === value['personaId']) &&
    LANGUAGE_CODES.some((language) => language === value['defaultLang']) &&
    typeof value['defaultCityId'] === 'string'
  );
}

/** Reads the verified authenticated user stored on Express `res.locals`. */
export function getAuthenticatedUser(res: Response): PublicUser | undefined {
  const candidate: unknown = res.locals[AUTH_USER_LOCAL_KEY];
  return isPublicUser(candidate) ? candidate : undefined;
}

/**
 * Requires a valid signed session token and stores the verified user on `res.locals`.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store');
  const token = extractSessionToken(req.headers.cookie, req.headers.authorization);
  if (token === undefined) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }
  const user = verifySessionToken(token);
  if (user === null) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required.' });
    return;
  }
  res.locals[AUTH_USER_LOCAL_KEY] = user;
  next();
}
