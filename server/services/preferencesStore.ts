/**
 * Session-isolated preferences storage combining bounded LRU cache with
 * HMAC-SHA256 signed HttpOnly cookie persistence across serverless instances.
 */

import crypto from 'node:crypto';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import type { UserProfile } from '../../src/domain/types.js';
import { createLruCache } from '../cache/lruCache.js';
import { getEnvConfig } from '../config/env.js';
import { logServerEvent } from '../config/logger.js';
import { UserProfileSchema } from '../middleware/requestSchemas.js';

/** Name of the HMAC-signed HttpOnly cookie storing session-scoped preferences. */
export const PREFS_COOKIE_NAME = 'smogwise_prefs';

const PREFERENCES_MAX_ENTRIES = 200;
const PREFERENCES_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'prefs:';
const MAX_COOKIE_VALUE_BYTES = 3072;

/** Versioned preferences record supporting optimistic concurrency via ETag / If-Match. */
export interface StoredPreferences {
  readonly profile: UserProfile;
  readonly version: number;
}

/** Result returned by version-checked preference persistence. */
export type SavePreferencesResult =
  | { readonly ok: true; readonly profile: UserProfile; readonly version: number }
  | { readonly ok: false; readonly currentVersion: number };

const preferencesCache = createLruCache<StoredPreferences>(
  PREFERENCES_MAX_ENTRIES,
  PREFERENCES_TTL_MS,
);

/** Scopes public demo accounts per session jti so concurrent visitors remain isolated. */
export function resolvePreferenceScopeKey(userId: string, sessionJti?: string): string {
  const cleanId = userId.trim();
  if (cleanId.startsWith('eval_') && sessionJti !== undefined && sessionJti.trim().length > 0) {
    return `${cleanId}:${sessionJti.trim()}`;
  }
  return cleanId;
}

function buildPreferenceKey(scopeKey: string): string {
  return `${KEY_PREFIX}${scopeKey.trim()}`;
}

/** Retrieves stored preferences and revision number for an authenticated scope key. */
export function getUserPreferencesRecord(scopeKey: string): StoredPreferences | undefined {
  const normalized = scopeKey.trim();
  if (normalized.length === 0) return undefined;
  const stored = preferencesCache.get(buildPreferenceKey(normalized));
  return stored === undefined
    ? undefined
    : { profile: structuredClone(stored.profile), version: stored.version };
}

/** Retrieves a cloned copy of saved preferences for an authenticated scope key. */
export function getUserPreferences(scopeKey: string): UserProfile | undefined {
  return getUserPreferencesRecord(scopeKey)?.profile;
}

/** Preserves a newer signed revision when a request arrives from another instance. */
export function newerPreferencesRecord(
  local: StoredPreferences | undefined,
  signed: StoredPreferences | undefined,
): StoredPreferences | undefined {
  if (local === undefined) return signed;
  return signed !== undefined && signed.version > local.version ? signed : local;
}

/** Persists household profile preferences with optional optimistic revision check. */
export function saveUserPreferencesVersioned(
  scopeKey: string,
  profile: UserProfile,
  expectedVersion?: number,
  cookieRecord?: StoredPreferences,
): SavePreferencesResult {
  const normalized = scopeKey.trim();
  const key = buildPreferenceKey(normalized);
  const cached = normalized.length > 0 ? preferencesCache.get(key) : undefined;
  const existing = newerPreferencesRecord(cached, cookieRecord);
  const currentVersion = existing?.version ?? 0;
  if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
    return { ok: false, currentVersion };
  }
  const version = currentVersion + 1;
  if (normalized.length > 0) {
    preferencesCache.set(key, { profile: structuredClone(profile), version });
  }
  return { ok: true, profile, version };
}

/** Persists a defensive clone of household profile preferences for a scope key. */
export function setUserPreferences(
  scopeKey: string,
  profile: UserProfile,
  version = 1,
): void {
  const normalized = scopeKey.trim();
  if (normalized.length === 0) return;
  preferencesCache.set(buildPreferenceKey(normalized), {
    profile: structuredClone(profile),
    version,
  });
}

function signDigest(encoded: string): string {
  return crypto
    .createHmac('sha256', getEnvConfig().authSecret)
    .update(encoded)
    .digest('base64url');
}

function extractNamedCookie(cookieHeader: string | undefined, target: string): string | undefined {
  if (cookieHeader === undefined || cookieHeader.trim().length === 0) return undefined;
  for (const segment of cookieHeader.split(';')) {
    const eqIdx = segment.indexOf('=');
    if (eqIdx <= 0) continue;
    if (segment.slice(0, eqIdx).trim() === target) {
      const val = segment.slice(eqIdx + 1).trim();
      return val.length > 0 ? val : undefined;
    }
  }
  return undefined;
}

/** Builds a signed HttpOnly cookie carrying preferences bound to expectedScopeKey. */
export function buildPreferencesCookie(
  scopeKey: string,
  profile: UserProfile,
  isSecure: boolean,
  version = 1,
): string | undefined {
  const encoded = Buffer.from(JSON.stringify({ s: scopeKey, p: profile, v: version }), 'utf8')
    .toString('base64url');
  const sig = signDigest(encoded);
  const value = `${encoded}.${sig}`;
  if (Buffer.byteLength(value, 'utf8') > MAX_COOKIE_VALUE_BYTES) {
    logServerEvent('warn', 'preferences_cookie_oversized', { bytes: value.length });
    return undefined;
  }
  const secureAttr = isSecure ? '; Secure' : '';
  return `${PREFS_COOKIE_NAME}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secureAttr}`;
}

/** Builds a Set-Cookie header clearing the signed preferences cookie on logout. */
export function buildClearPreferencesCookie(isSecure: boolean): string {
  const secureAttr = isSecure ? '; Secure' : '';
  return `${PREFS_COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secureAttr}`;
}

function isSignatureValid(encoded: string, providedSig: string): boolean {
  const expected = signDigest(encoded);
  const left = Buffer.from(providedSig, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length > 0 && left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sanitizeCleanProfile(data: ReturnType<typeof UserProfileSchema.parse>): UserProfile {
  const customLoc = data.customLocation;
  return {
    persona: data.persona,
    cityId: data.cityId,
    language: data.language,
    householdSize: data.householdSize,
    hasVulnerableMember: data.hasVulnerableMember,
    monthlyBudgetInr: data.monthlyBudgetInr,
    roomVolumeM3: data.roomVolumeM3,
    commuteMode: data.commuteMode,
    commuteDistanceKm: data.commuteDistanceKm,
    cookingFuel: data.cookingFuel,
    activeHacks: Array.from(new Set(data.activeHacks)),
    ...(customLoc !== undefined
      ? {
          customLocation: {
            name: customLoc.name,
            lat: customLoc.lat,
            lon: customLoc.lon,
            ...(customLoc.state !== undefined ? { state: customLoc.state } : {}),
          },
        }
      : {}),
    ...(data.rwaHouseholds !== undefined ? { rwaHouseholds: data.rwaHouseholds } : {}),
    ...(data.rwaAdoptionRate !== undefined ? { rwaAdoptionRate: data.rwaAdoptionRate } : {}),
  };
}

function extractCookieVersion(rawVer: unknown): number {
  return typeof rawVer === 'number' && Number.isSafeInteger(rawVer) && rawVer >= 1 ? rawVer : 1;
}

function extractVerifiedCookieSegment(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const parts = raw.split('.');
  const encoded = parts[0];
  const sig = parts[1];
  if (parts.length !== 2 || encoded === undefined || sig === undefined) return undefined;
  return isSignatureValid(encoded, sig) ? encoded : undefined;
}

function decodeSignedPayload(
  raw: string | undefined,
  expectedScopeKey: string,
): StoredPreferences | undefined {
  const encoded = extractVerifiedCookieSegment(raw);
  if (encoded === undefined) return undefined;
  const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!isPlainRecord(parsed) || parsed['s'] !== expectedScopeKey) return undefined;
  const checked = UserProfileSchema.safeParse(parsed['p']);
  if (!checked.success) return undefined;
  return {
    profile: sanitizeCleanProfile(checked.data),
    version: extractCookieVersion(parsed['v']),
  };
}

/** Verifies and extracts saved preferences and revision bound to the expected scopeKey. */
export function readPreferencesCookieRecord(
  cookieHeader: string | undefined,
  expectedScopeKey: string,
): StoredPreferences | undefined {
  const raw = extractNamedCookie(cookieHeader, PREFS_COOKIE_NAME);
  try {
    return decodeSignedPayload(raw, expectedScopeKey);
  } catch (err: unknown) {
    logServerEvent('warn', 'preferences_cookie_parse_failed', {
      errorName: err instanceof Error ? err.name : 'ParseError',
    });
    return undefined;
  }
}

/** Verifies and extracts a saved UserProfile cookie bound to the expected scopeKey. */
export function readPreferencesCookie(
  cookieHeader: string | undefined,
  expectedScopeKey: string,
): UserProfile | undefined {
  return readPreferencesCookieRecord(cookieHeader, expectedScopeKey)?.profile;
}
