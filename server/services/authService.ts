/**
 * Authentication service providing salted scrypt verification, HMAC-SHA256 tokens,
 * and bounded jti revocation on logout.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { createLruCache } from '../cache/lruCache.js';
import {
  DUMMY_SCRYPT_RECORD,
  findAccountByEmail,
  toPublicUser,
  type PublicUser,
  type StoredAuthAccount,
} from '../config/authAccounts.js';
import { getEnvConfig } from '../config/env.js';

/** Name of the HTTP-only session cookie issued on login. */
export const SESSION_COOKIE_NAME = 'smogwise_session';

const SESSION_TTL_SECONDS = 86400;
const MAX_CLOCK_SKEW_SECONDS = 60;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1 };
const REVOKED_JTI_CACHE_SIZE = 1000;

const revokedJtiCache = createLruCache<true>(
  REVOKED_JTI_CACHE_SIZE,
  SESSION_TTL_SECONDS * 1000,
);

const SessionTokenPayloadSchema = z.object({
  sub: z.string().trim().min(1),
  email: z.string().trim().min(1),
  name: z.string().trim().min(1),
  personaId: z.enum([
    'young_family',
    'sensitive_household',
    'rwa_coordinator',
    'office_commuter',
    'outdoor_student',
  ]),
  defaultLang: z.enum(['en', 'hi']),
  defaultCityId: z.string().trim().min(1),
  jti: z.string().trim().min(8).max(64),
  iat: z.number().finite(),
  exp: z.number().finite(),
});

type SessionTokenPayload = z.infer<typeof SessionTokenPayloadSchema>;

function computeHmacSignature(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function constantTimeBufferHexEqual(derivedBuf: Buffer, targetHex: string): boolean {
  const rightBuf = Buffer.from(targetHex, 'hex');
  if (derivedBuf.length === 0 || derivedBuf.length !== rightBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(derivedBuf, rightBuf);
}

function constantTimeUtf8Equal(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function deriveScryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS, (err, derivedKey) => {
      if (err !== null) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

function parseSessionPayload(encodedPayload: string): SessionTokenPayload | null {
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    const checked = SessionTokenPayloadSchema.safeParse(parsed);
    if (!checked.success) {
      return null;
    }
    const { iat, exp } = checked.data;
    if (exp <= iat || exp - iat > SESSION_TTL_SECONDS) {
      return null;
    }
    return checked.data;
  } catch (err: unknown) {
    void err;
    return null;
  }
}

interface CredentialCheckTarget {
  readonly account: StoredAuthAccount | undefined;
  readonly salt: string;
  readonly hash: string;
}

function resolveCredentialTarget(email: string): CredentialCheckTarget {
  const account = findAccountByEmail(email);
  return {
    account,
    salt: account?.salt ?? DUMMY_SCRYPT_RECORD.salt,
    hash: account?.passwordHash ?? DUMMY_SCRYPT_RECORD.passwordHash,
  };
}

function finalizeCredentialCheck(
  account: StoredAuthAccount | undefined,
  derivedBuf: Buffer,
  targetHash: string,
): PublicUser | null {
  const matches = constantTimeBufferHexEqual(derivedBuf, targetHash);
  if (account === undefined || !matches) {
    return null;
  }
  return toPublicUser(account);
}

/**
 * Verifies user email and password synchronously in constant time using scryptSync.
 */
export function verifyCredentials(email: string, password: string): PublicUser | null {
  if (password.length === 0) {
    return null;
  }
  const target = resolveCredentialTarget(email);
  const derivedBuf = crypto.scryptSync(password, target.salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS);
  return finalizeCredentialCheck(target.account, derivedBuf, target.hash);
}

/**
 * Verifies user email and password asynchronously without blocking the event loop.
 */
export async function verifyCredentialsAsync(
  email: string,
  password: string,
): Promise<PublicUser | null> {
  if (password.length === 0) {
    return null;
  }
  const target = resolveCredentialTarget(email);
  const derivedBuf = await deriveScryptAsync(password, target.salt);
  return finalizeCredentialCheck(target.account, derivedBuf, target.hash);
}

/**
 * Signs an HMAC-SHA256 session token with a unique jti and 24-hour TTL.
 */
export function signSessionToken(user: PublicUser, nowMs = Date.now()): string {
  const iat = Math.floor(nowMs / 1000);
  const payload: SessionTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    personaId: user.personaId,
    defaultLang: user.defaultLang,
    defaultCityId: user.defaultCityId,
    jti: crypto.randomUUID(),
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = computeHmacSignature(encodedPayload, getEnvConfig().authSecret);
  return `${encodedPayload}.${signature}`;
}

function verifyAndDecodeToken(token: string, nowMs: number): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, signature] = parts;
  if (!isNonEmptyString(encodedPayload) || !isNonEmptyString(signature)) {
    return null;
  }
  const expectedSig = computeHmacSignature(encodedPayload, getEnvConfig().authSecret);
  if (!constantTimeUtf8Equal(signature, expectedSig)) {
    return null;
  }
  const payload = parseSessionPayload(encodedPayload);
  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    payload === null ||
    payload.exp <= nowSeconds ||
    payload.iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS ||
    revokedJtiCache.get(payload.jti) === true
  ) {
    return null;
  }
  return payload;
}

/**
 * Verifies an HMAC-SHA256 session token and returns the embedded PublicUser when valid.
 */
export function verifySessionToken(token: string, nowMs = Date.now()): PublicUser | null {
  const payload = verifyAndDecodeToken(token, nowMs);
  if (payload === null) {
    return null;
  }
  return {
    id: payload.sub,
    email: payload.email,
    name: payload.name,
    personaId: payload.personaId,
    defaultLang: payload.defaultLang,
    defaultCityId: payload.defaultCityId,
  };
}

/**
 * Revokes a valid session token's jti in the bounded LRU revocation set on logout.
 */
export function revokeSessionToken(token: string, nowMs = Date.now()): boolean {
  const payload = verifyAndDecodeToken(token, nowMs);
  if (payload === null) {
    return false;
  }
  const remainingTtlMs = Math.max(1000, (payload.exp - Math.floor(nowMs / 1000)) * 1000);
  revokedJtiCache.set(payload.jti, true, remainingTtlMs);
  return true;
}

/** Clears revoked session token entries (used in unit tests). */
export function clearRevokedSessionTokens(): void {
  revokedJtiCache.clear();
}

function extractCookieToken(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim().length === 0) {
    return undefined;
  }
  for (const segment of cookieHeader.split(';')) {
    const eqIndex = segment.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = segment.slice(0, eqIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      const value = segment.slice(eqIndex + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}

function extractBearerToken(authHeader: string | undefined): string | undefined {
  if (authHeader === undefined) {
    return undefined;
  }
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) {
    return undefined;
  }
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Extracts a session token from the Cookie header or Authorization Bearer header.
 */
export function extractSessionToken(
  cookieHeader?: string,
  authHeader?: string,
): string | undefined {
  return extractCookieToken(cookieHeader) ?? extractBearerToken(authHeader);
}

/**
 * Builds a Set-Cookie header value establishing an authenticated session.
 */
export function buildSessionCookie(token: string, isSecure: boolean): string {
  const secureAttr = isSecure ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; ` +
    `Max-Age=${SESSION_TTL_SECONDS}${secureAttr}`
  );
}

/**
 * Builds a Set-Cookie header value clearing the session cookie.
 */
export function buildClearSessionCookie(isSecure: boolean): string {
  const secureAttr = isSecure ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr}`;
}
