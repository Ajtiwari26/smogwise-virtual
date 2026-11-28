/**
 * Pure helpers for Open-Meteo timestamp normalization, Haversine nearest-preset
 * fallback selection, and AirQualityLookupResult construction.
 */

import {
  findNearestCityPresetWithDistance,
  haversineKm,
} from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { applyLiveAqOverride, buildObservationId } from '../../src/domain/liveAqResolver.js';
import { round4 } from '../../src/domain/domainUtils.js';
import type {
  AqiBandId,
  AqResolutionStatus,
  CityPreset,
  DominantPollutant,
  LiveAqOverride,
} from '../../src/domain/types.js';
import { sanitizeLocationText } from '../middleware/locationGuard.js';

const SHORT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const FULL_NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Re-exported shared Haversine distance helper in kilometers. */
export { haversineKm };

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
  readonly aqStatus: AqResolutionStatus;
  readonly observationId: string;
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

/** Finds the nearest Indian city preset and its Haversine distance in kilometers. */
export function findNearestIndianPreset(lat: number, lon: number): {
  readonly preset: CityPreset;
  readonly distanceKm: number;
} {
  return findNearestCityPresetWithDistance(lat, lon);
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
    lat: input.lat,
    lon: input.lon,
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
  if (liveAq === null) {
    return {
      ...buildBaseLookupFields(
        city, city.baselinePm25, city.baselinePm10, city.baselineNo2, 'city_preset',
      ),
      aqStatus: 'nearby_proxy',
      observationId: buildObservationId(city, 'nearby_proxy'),
    };
  }
  const effectiveCity = applyLiveAqOverride(city, liveAq).city;
  const { pm25, pm10, no2, observedAt } = liveAq;
  return {
    ...buildBaseLookupFields(city, pm25, pm10, no2, 'live_open_meteo'),
    aqStatus: 'live',
    observationId: buildObservationId(effectiveCity, 'live', observedAt),
    ...(observedAt !== undefined ? { observedAt } : {}),
    liveAq,
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
    fallbackDistanceKm: distanceKm,
  };
  return {
    aqStatus: 'nearby_proxy',
    observationId: buildObservationId(syntheticCity, 'nearby_proxy'),
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
