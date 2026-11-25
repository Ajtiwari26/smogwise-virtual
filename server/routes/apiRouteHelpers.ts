/**
 * Profile normalization and air-quality lookup helpers for SmogWise Express routes.
 */

import type { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import type { LanguageCode, UserProfile } from '../../src/domain/types.js';
import type { UserProfileSchema } from '../middleware/promptGuard.js';
import {
  fetchAirQualityForCity,
  fetchAirQualityForCoords,
  isUnsafeCityInput,
} from '../services/openMeteoClient.js';
import type { AirQualityLookupResult } from '../services/openMeteoClient.js';

export type ParsedProfile = z.infer<typeof UserProfileSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Converts validated custom location fields into the domain CustomLocation shape. */
export function toCustomLocation(
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
    activeHacks: parsed.activeHacks,
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

/** Extracts a profile object from either `{ profile }` wrappers or direct request bodies. */
export function extractProfilePayload(body: unknown): unknown {
  if (isRecord(body) && 'profile' in body) {
    return body['profile'];
  }
  return body;
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
