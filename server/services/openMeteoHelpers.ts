/**
 * Pure helpers for Open-Meteo timestamp normalization, Haversine nearest-preset
 * fallback selection, and AirQualityLookupResult construction.
 */

import { CITY_PRESETS } from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { round4 } from '../../src/domain/domainUtils.js';
import type {
  AqiBandId,
  CityPreset,
  DominantPollutant,
  LiveAqOverride,
} from '../../src/domain/types.js';
import { sanitizeLocationText } from '../middleware/locationGuard.js';

const EARTH_RADIUS_KM = 6371;
const SHORT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const FULL_NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Input coordinates and optional display labels for custom-location AQ lookups. */
export interface CoordinateAqInput {
  readonly lat: number;
  readonly lon: number;
  readonly name?: string;
  readonly state?: string;
}

/** Result returned by the Open-Meteo air-quality client. */
export interface AirQualityLookupResult {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly aqiBand: AqiBandId;
  readonly dominantPollutant: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
  readonly liveAq?: LiveAqOverride;
  readonly fetchedAt: string;
  readonly cached: boolean;
}

/** Adds IST to offset-free Open-Meteo times and preserves explicit offsets. */
export function normalizeObservedAt(raw?: string): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  let candidate = trimmed;
  if (SHORT_ISO_RE.test(trimmed)) {
    candidate = `${trimmed}:00+05:30`;
  } else if (FULL_NAIVE_ISO_RE.test(trimmed)) {
    candidate = `${trimmed}+05:30`;
  }
  return Number.isFinite(Date.parse(candidate)) ? candidate : undefined;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Computes Haversine great-circle distance in kilometers between two coordinates. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const rawA =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const clampedA = Math.min(1, Math.max(0, rawA));
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

/** Finds the nearest Indian city preset and its Haversine distance in kilometers. */
export function findNearestIndianPreset(lat: number, lon: number): {
  readonly preset: CityPreset;
  readonly distanceKm: number;
} {
  let nearestPreset: CityPreset | undefined;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const preset of CITY_PRESETS) {
    const dist = haversineKm(lat, lon, preset.lat, preset.lon);
    if (dist < minDistance) {
      minDistance = dist;
      nearestPreset = preset;
    }
  }
  if (nearestPreset === undefined) {
    throw new Error('CITY_PRESETS must contain at least one preset.');
  }
  return { preset: nearestPreset, distanceKm: minDistance };
}

/** Builds a synthetic CityPreset for a custom map coordinate anchored to the nearest station. */
export function buildSyntheticCityPreset(
  input: CoordinateAqInput,
  nearestPreset: CityPreset,
): CityPreset {
  const cleanName = sanitizeLocationText(input.name ?? '');
  const cleanState = sanitizeLocationText(input.state ?? '');
  const displayName = cleanName.length > 0 ? cleanName : `${nearestPreset.name} Area`;
  const displayState = cleanState.length > 0 ? cleanState : nearestPreset.state;
  const lat = round4(input.lat);
  const lon = round4(input.lon);
  return {
    id: `custom_${String(lat)}_${String(lon)}`,
    name: displayName,
    nameHi: displayName,
    state: displayState,
    lat,
    lon,
    baselinePm25: nearestPreset.baselinePm25,
    baselinePm10: nearestPreset.baselinePm10,
    baselineNo2: nearestPreset.baselineNo2,
    grapStage: nearestPreset.grapStage,
  };
}

function buildBaseLookupFields(
  city: CityPreset,
  pm25: number,
  pm10: number | undefined,
  no2: number | undefined,
  dataSource: 'live_open_meteo' | 'city_preset',
) {
  const cpcb = computeCpcbAqi(pm25, pm10, no2);
  return {
    city,
    dataSource,
    cpcbAqi: cpcb.aqi,
    aqiBand: cpcb.band,
    dominantPollutant: cpcb.dominantPollutant,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/** Builds a live or preset AirQualityLookupResult from city metadata and optional live AQ. */
export function buildLookupResult(
  city: CityPreset,
  liveAq: LiveAqOverride | null,
): AirQualityLookupResult {
  const pm25 = liveAq?.pm25 ?? city.baselinePm25;
  const pm10 = liveAq !== null ? liveAq.pm10 : city.baselinePm10;
  const no2 = liveAq !== null ? liveAq.no2 : city.baselineNo2;
  const dataSource = liveAq !== null ? 'live_open_meteo' : 'city_preset';
  return {
    ...buildBaseLookupFields(city, pm25, pm10, no2, dataSource),
    ...(liveAq?.observedAt !== undefined ? { observedAt: liveAq.observedAt } : {}),
    ...(liveAq !== null ? { liveAq } : {}),
  };
}

/** Builds a <=50 km nearest-station fallback AirQualityLookupResult for offline coordinates. */
export function buildNearestFallbackResult(
  syntheticCity: CityPreset,
  nearestPreset: CityPreset,
  distanceKm: number,
): AirQualityLookupResult {
  const roundedDist = Math.round(distanceKm * 10) / 10;
  const fallbackOverride: LiveAqOverride = {
    pm25: nearestPreset.baselinePm25,
    pm10: nearestPreset.baselinePm10,
    no2: nearestPreset.baselineNo2,
    sourceLabel:
      `Nearest station fallback: ${nearestPreset.name} (${String(Math.round(distanceKm))} km away)`,
    fallbackStationName: nearestPreset.name,
    fallbackDistanceKm: roundedDist,
  };
  return {
    ...buildBaseLookupFields(
      syntheticCity,
      nearestPreset.baselinePm25,
      nearestPreset.baselinePm10,
      nearestPreset.baselineNo2,
      'city_preset',
    ),
    fallbackStationName: nearestPreset.name,
    fallbackDistanceKm: roundedDist,
    liveAq: fallbackOverride,
  };
}
