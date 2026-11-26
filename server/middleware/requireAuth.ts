/**
 * Express authentication middleware verifying signed session cookies or Bearer tokens.
 */

import type { NextFunction, Request, Response } from 'express';
import type { PublicUser } from '../config/authAccounts.js';
import { extractSessionToken, verifySessionToken } from '../services/authService.js';

/** Express Request augmented with the verified authenticated user record. */
export interface AuthenticatedRequest extends Request {
  authUser?: PublicUser;
}

/**
 * Requires a valid signed session token and populates `req.authUser`.
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
  (req as AuthenticatedRequest).authUser = user;
  next();
}
