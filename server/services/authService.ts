/**
 * Authentication service providing scrypt credential verification and HMAC-SHA256 tokens.
 */

import crypto from 'node:crypto';
import type { LanguageCode, PersonaType } from '../../src/domain/types.js';
import {
  DUMMY_SCRYPT_RECORD,
  findAccountByEmail,
  toPublicUser,
  type PublicUser,
} from '../config/authAccounts.js';
import { getEnvConfig } from '../config/env.js';

/** Name of the HTTP-only session cookie issued on login. */
export const SESSION_COOKIE_NAME = 'smogwise_session';

const SESSION_TTL_SECONDS = 86400;
const SCRYPT_KEY_LENGTH = 64;
const VALID_PERSONAS: ReadonlySet<string> = new Set<PersonaType>([
  'young_family',
  'sensitive_household',
  'rwa_coordinator',
  'office_commuter',
  'outdoor_student',
]);
const VALID_LANGS: ReadonlySet<string> = new Set<LanguageCode>(['en', 'hi']);

interface SessionTokenPayload {
  readonly sub: string;
  readonly email: string;
  readonly name: string;
  readonly personaId: PersonaType;
  readonly defaultLang: LanguageCode;
  readonly defaultCityId: string;
  readonly iat: number;
  readonly exp: number;
}

function computeHmacSignature(encodedPayload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function constantTimeHexEqual(leftHex: string, rightHex: string): boolean {
  const leftBuf = Buffer.from(leftHex, 'hex');
  const rightBuf = Buffer.from(rightHex, 'hex');
  if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(leftBuf, rightBuf);
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

function parseSessionPayload(encodedPayload: string): SessionTokenPayload | null {
  try {
    const decoded = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    if (parsed === null || typeof parsed !== 'object') {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (!hasValidPayloadStrings(record) || !hasValidPayloadTimes(record)) {
      return null;
    }
    return {
      sub: record['sub'] as string,
      email: record['email'] as string,
      name: record['name'] as string,
      personaId: record['personaId'] as PersonaType,
      defaultLang: record['defaultLang'] as LanguageCode,
      defaultCityId: record['defaultCityId'] as string,
      iat: record['iat'] as number,
      exp: record['exp'] as number,
    };
  } catch {
    return null;
  }
}

function hasValidPayloadStrings(record: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(record['sub']) &&
    isNonEmptyString(record['email']) &&
    isNonEmptyString(record['name']) &&
    isNonEmptyString(record['defaultCityId']) &&
    typeof record['personaId'] === 'string' &&
    VALID_PERSONAS.has(record['personaId']) &&
    typeof record['defaultLang'] === 'string' &&
    VALID_LANGS.has(record['defaultLang'])
  );
}

function hasValidPayloadTimes(record: Record<string, unknown>): boolean {
  const iat = record['iat'];
  const exp = record['exp'];
  return (
    typeof iat === 'number' &&
    Number.isFinite(iat) &&
    typeof exp === 'number' &&
    Number.isFinite(exp) &&
    exp > iat
  );
}

/**
 * Verifies user email and password in constant time using scryptSync and timingSafeEqual.
 */
export function verifyCredentials(email: string, password: string): PublicUser | null {
  if (password.length === 0) {
    return null;
  }
  const account = findAccountByEmail(email);
  const targetSalt = account?.salt ?? DUMMY_SCRYPT_RECORD.salt;
  const targetHash = account?.passwordHash ?? DUMMY_SCRYPT_RECORD.passwordHash;
  const derivedHex = crypto.scryptSync(password, targetSalt, SCRYPT_KEY_LENGTH).toString('hex');
  const matches = constantTimeHexEqual(derivedHex, targetHash);
  if (account === undefined || !matches) {
    return null;
  }
  return toPublicUser(account);
}

/**
 * Signs an HMAC-SHA256 session token for an authenticated user with a 24-hour TTL.
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
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = computeHmacSignature(encodedPayload, getEnvConfig().authSecret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Verifies an HMAC-SHA256 session token and returns the embedded PublicUser when valid.
 */
export function verifySessionToken(token: string, nowMs = Date.now()): PublicUser | null {
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
  if (payload === null || payload.exp <= nowSeconds) {
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
export function buildSessionCookie(token: string, isProd: boolean): string {
  const secureAttr = isProd ? '; Secure' : '';
  return (
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; ` +
    `Max-Age=${SESSION_TTL_SECONDS}${secureAttr}`
  );
}

/**
 * Builds a Set-Cookie header value clearing the session cookie.
 */
export function buildClearSessionCookie(isProd: boolean): string {
  const secureAttr = isProd ? '; Secure' : '';
  return `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr}`;
}
