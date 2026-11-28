/**
 * Profile normalization, Express async route wrapping, and air-quality lookup helpers.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import type { LanguageCode, UserProfile } from '../../src/domain/types.js';
import { isUnsafeCityInput } from '../middleware/locationGuard.js';
import {
  PreferencesEnvelopeSchema,
  UserProfileSchema,
  WrappedProfileEnvelopeSchema,
} from '../middleware/requestSchemas.js';
import {
  fetchAirQualityForCity,
  fetchAirQualityForCoords,
  LiveAqUnavailableError,
} from '../services/openMeteoClient.js';
import type { AirQualityLookupResult } from '../services/openMeteoHelpers.js';

/** Validated Express request profile shape inferred from UserProfileSchema. */
type ParsedProfile = z.infer<typeof UserProfileSchema>;

/** Async Express handler signature handled safely by route wrappers. */
type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

/** Async Express handler signature without explicit next forwarding boilerplate. */
type AqRouteHandler = (req: Request, res: Response) => Promise<void>;

/** Wraps an async Express route handler so rejected promises forward to error middleware. */
export function wrapAsyncRoute(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

function handleAqRouteError(res: Response, err: unknown, next: NextFunction): void {
  if (err instanceof LiveAqUnavailableError) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }
  next(err);
}

/**
 * Wraps an async AQ/plan route handler with private, no-store caching and
 * unified LiveAqUnavailableError -> HTTP 503 mapping.
 */
export function wrapAqRoute(handler: AqRouteHandler): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store');
    void handler(req, res).catch((err: unknown) => {
      handleAqRouteError(res, err, next);
    });
  };
}

function toCustomLocation(
  raw: NonNullable<ParsedProfile['customLocation']>,
): NonNullable<UserProfile['customLocation']> {
  if (raw.state !== undefined && raw.state.length > 0) {
    return { name: raw.name, state: raw.state, lat: raw.lat, lon: raw.lon };
  }
  return { name: raw.name, lat: raw.lat, lon: raw.lon };
}

/** Converts a Zod-parsed profile payload into a strict domain UserProfile. */
export function toUserProfile(parsed: ParsedProfile): UserProfile {
  const customLocation =
    parsed.customLocation !== undefined ? toCustomLocation(parsed.customLocation) : undefined;
  return {
    persona: parsed.persona,
    cityId: parsed.cityId,
    language: parsed.language,
    householdSize: parsed.householdSize,
    hasVulnerableMember: parsed.hasVulnerableMember,
    monthlyBudgetInr: parsed.monthlyBudgetInr,
    roomVolumeM3: parsed.roomVolumeM3,
    commuteMode: parsed.commuteMode,
    commuteDistanceKm: parsed.commuteDistanceKm,
    cookingFuel: parsed.cookingFuel,
    activeHacks: Array.from(new Set(parsed.activeHacks)),
    ...(customLocation !== undefined ? { customLocation } : {}),
    ...(parsed.rwaHouseholds !== undefined ? { rwaHouseholds: parsed.rwaHouseholds } : {}),
    ...(parsed.rwaAdoptionRate !== undefined ? { rwaAdoptionRate: parsed.rwaAdoptionRate } : {}),
  };
}

/** Builds a safe default household profile for unauthenticated quick AI queries. */
export function buildDefaultProfile(city?: string, language: LanguageCode = 'en'): UserProfile {
  const safeCity = city !== undefined && !isUnsafeCityInput(city) ? city : 'delhi_anand_vihar';
  const preset = resolveCityPreset(safeCity);
  return {
    persona: 'young_family',
    cityId: preset.id,
    language,
    householdSize: 4,
    hasVulnerableMember: true,
    monthlyBudgetInr: 3000,
    roomVolumeM3: 45,
    commuteMode: 'petrol_car',
    commuteDistanceKm: 15,
    cookingFuel: 'lpg',
    activeHacks: ['window_sealing', 'wet_mopping'],
  };
}

/** Parsed `/api/plan` or `/api/plan/briefing` request payload, live-AQ flag, and token. */
interface ParsedPlanRequest {
  readonly profile: UserProfile;
  readonly useLiveAq: boolean;
  readonly snapshotToken?: string;
}

/**
 * Parses either a `{ profile, useLiveAq?, snapshotToken? }` envelope or a direct UserProfile
 * for plan and briefing routes, preserving explicit `useLiveAq: false` flags.
 */
export function parsePlanRequest(body: unknown): ParsedPlanRequest {
  if (isPlainRecord(body) && Object.hasOwn(body, 'profile')) {
    const envelope = WrappedProfileEnvelopeSchema.parse(body);
    return {
      profile: toUserProfile(envelope.profile),
      useLiveAq: envelope.useLiveAq ?? true,
      ...(envelope.snapshotToken !== undefined ? { snapshotToken: envelope.snapshotToken } : {}),
    };
  }
  return {
    profile: toUserProfile(UserProfileSchema.parse(body)),
    useLiveAq: true,
  };
}

/** Parsed preferences payload including optional optimistic-concurrency version. */
export interface ParsedPreferencesSave {
  readonly profile: UserProfile;
  readonly expectedVersion?: number;
}

/**
 * Parses `{ profile, expectedVersion? }` or a raw UserProfile payload for preferences storage.
 */
export function parsePreferencesSaveInput(body: unknown): ParsedPreferencesSave {
  if (isPlainRecord(body) && Object.hasOwn(body, 'profile')) {
    const parsed = PreferencesEnvelopeSchema.parse(body);
    return {
      profile: toUserProfile(parsed.profile),
      ...(parsed.expectedVersion !== undefined ? { expectedVersion: parsed.expectedVersion } : {}),
    };
  }
  return { profile: toUserProfile(UserProfileSchema.parse(body)) };
}

/** Parses a preferences save body and returns the normalized domain UserProfile. */
export function parsePreferencesProfile(body: unknown): UserProfile {
  return parsePreferencesSaveInput(body).profile;
}

/** Fetches live or fallback air quality for either custom coordinates or preset city IDs. */
export async function resolveProfileAq(profile: UserProfile): Promise<AirQualityLookupResult> {
  if (profile.customLocation !== undefined) {
    const loc = profile.customLocation;
    return fetchAirQualityForCoords({
      lat: loc.lat,
      lon: loc.lon,
      name: loc.name,
      ...(loc.state !== undefined ? { state: loc.state } : {}),
    });
  }
  return fetchAirQualityForCity(profile.cityId);
}
