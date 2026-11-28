/**
 * Server-signed short-lived AQ snapshot tokens carrying authoritative observation identity
 * across /api/plan, /api/plan/briefing, and /api/ai/ask without trusting client pollutants.
 */

import crypto from 'node:crypto';
import { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import type { LiveAqOverride, UserProfile } from '../../src/domain/types.js';
import { getEnvConfig } from '../config/env.js';

const TOKEN_TTL_MS = 10 * 60 * 1000;
const PROCESS_SIGNING_KEY = crypto.randomBytes(32).toString('hex');

const SnapshotPayloadSchema = z.object({
  loc: z.string().min(1),
  exp: z.number().finite(),
  aq: z.object({
    pm25: z.number().finite().min(0),
    pm10: z.number().finite().min(0).optional(),
    no2: z.number().finite().min(0).optional(),
    observedAt: z.string().optional(),
    cpcbAqi: z.number().finite().min(0).optional(),
    dominantPollutant: z.enum(['PM2.5', 'PM10', 'NO2']).optional(),
    sourceLabel: z.string().optional(),
    fallbackStationName: z.string().optional(),
    fallbackDistanceKm: z.number().finite().min(0).optional(),
  }).nullable(),
});

function getSigningSecret(): string {
  const { authSecret } = getEnvConfig();
  return authSecret.length >= 32 ? authSecret : PROCESS_SIGNING_KEY;
}

function buildLocationTargetKey(profile: UserProfile): string {
  if (profile.customLocation !== undefined) {
    const { lat, lon } = profile.customLocation;
    return `coords:${lat.toFixed(6)},${lon.toFixed(6)}`;
  }
  return `preset:${resolveCityPreset(profile.cityId).id}`;
}

function signEncoded(encoded: string): string {
  return crypto.createHmac('sha256', getSigningSecret()).update(encoded).digest('base64url');
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

/** Issues an HMAC-signed snapshot token bound to a profile's canonical AQ location. */
export function signAqSnapshotToken(
  profile: UserProfile,
  liveAq: LiveAqOverride | undefined,
): string {
  const payload = {
    loc: buildLocationTargetKey(profile),
    exp: Date.now() + TOKEN_TTL_MS,
    aq: liveAq ?? null,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signEncoded(encoded)}`;
}

function toLiveAqOverride(
  aq: NonNullable<z.infer<typeof SnapshotPayloadSchema>['aq']>,
): LiveAqOverride {
  return {
    pm25: aq.pm25,
    ...(aq.pm10 !== undefined ? { pm10: aq.pm10 } : {}),
    ...(aq.no2 !== undefined ? { no2: aq.no2 } : {}),
    ...(aq.observedAt !== undefined ? { observedAt: aq.observedAt } : {}),
    ...(aq.cpcbAqi !== undefined ? { cpcbAqi: aq.cpcbAqi } : {}),
    ...(aq.dominantPollutant !== undefined ? { dominantPollutant: aq.dominantPollutant } : {}),
    ...(aq.sourceLabel !== undefined ? { sourceLabel: aq.sourceLabel } : {}),
    ...(aq.fallbackStationName !== undefined
      ? { fallbackStationName: aq.fallbackStationName } : {}),
    ...(aq.fallbackDistanceKm !== undefined ? { fallbackDistanceKm: aq.fallbackDistanceKm } : {}),
  };
}

type VerifySnapshotResult =
  | { readonly valid: true; readonly liveAq: LiveAqOverride | undefined }
  | { readonly valid: false };

function parseVerifiedTokenPayload(encoded: string, profile: UserProfile): VerifySnapshotResult {
  try {
    const parsedJson: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const parsed = SnapshotPayloadSchema.safeParse(parsedJson);
    if (!parsed.success) return { valid: false };
    if (parsed.data.exp < Date.now() || parsed.data.loc !== buildLocationTargetKey(profile)) {
      return { valid: false };
    }
    return {
      valid: true,
      liveAq: parsed.data.aq === null ? undefined : toLiveAqOverride(parsed.data.aq),
    };
  } catch {
    return { valid: false };
  }
}

/** Verifies signature, expiry, and location binding; returns certified LiveAqOverride. */
export function verifyAqSnapshotToken(
  token: string | undefined,
  profile: UserProfile,
): VerifySnapshotResult {
  if (token === undefined) return { valid: false };
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0 || dotIdx === token.length - 1) return { valid: false };
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!constantTimeEqual(sig, signEncoded(encoded))) return { valid: false };
  return parseVerifiedTokenPayload(encoded, profile);
}
