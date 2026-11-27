/**
 * SSRF-safe Open-Meteo Air Quality client with partitioned LRU caches,
 * bounded singleflight coalescing, CPCB NAQI scoring, and <= 50 km fallback.
 */

import { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { round2 } from '../../src/domain/domainUtils.js';
import type { CityPreset, LiveAqOverride } from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { isUnsafeCityInput } from '../middleware/locationGuard.js';
import { fetchBoundedJson } from './httpFetch.js';
import {
  buildLookupResult,
  buildNearestFallbackResult,
  buildSyntheticCityPreset,
  findNearestIndianPreset,
  normalizeObservedAt,
} from './openMeteoHelpers.js';
import type { AirQualityLookupResult, CoordinateAqInput } from './openMeteoHelpers.js';

const OpenMeteoResponseSchema = z.object({
  current: z.object({
    time: z.string().nullish().transform((v) => v ?? undefined),
    pm2_5: z.number().finite().min(0).max(2500),
    pm10: z.number().finite().min(0).max(3500).nullish().transform((v) => v ?? undefined),
    nitrogen_dioxide: z
      .number()
      .finite()
      .min(0)
      .max(1500)
      .nullish()
      .transform((v) => v ?? undefined),
  }),
});

const OPEN_METEO_ENDPOINT = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const FETCH_TIMEOUT_MS = 3500;
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_FALLBACK_DISTANCE_KM = 50;

/** Error thrown when live AQ lookup fails and no Indian preset exists within 50 km. */
export class LiveAqUnavailableError extends Error {
  /** Machine-readable 503 error code returned to API callers. */
  readonly code = 'LIVE_AQ_UNAVAILABLE' as const;

  constructor(message = 'Live air quality data is temporarily unavailable for this location.') {
    super(message);
    this.name = 'LiveAqUnavailableError';
  }
}

interface LiveAqSnapshot {
  readonly liveAq: LiveAqOverride;
  readonly fetchedAt: string;
}

const presetAqCache = createLruCache<LiveAqSnapshot>(32, CACHE_TTL_MS);
const customAqCache = createLruCache<LiveAqSnapshot>(128, CACHE_TTL_MS);
const aqSingleflight = createSingleflight<LiveAqSnapshot | null>(100);

function clampCoord(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function quantizeGrid(value: number): number {
  return Math.round(value * 20) / 20;
}

function buildOpenMeteoUrl(lat: number, lon: number): string {
  const safeLat = clampCoord(lat, -90, 90).toFixed(4);
  const safeLon = clampCoord(lon, -180, 180).toFixed(4);
  const params = new URLSearchParams({
    latitude: safeLat,
    longitude: safeLon,
    current: 'pm2_5,pm10,nitrogen_dioxide',
  });
  return `${OPEN_METEO_ENDPOINT}?${params.toString()}&timezone=Asia%2FKolkata`;
}

function parseLiveAqPayload(payload: unknown): LiveAqOverride | null {
  const checked = OpenMeteoResponseSchema.safeParse(payload);
  if (!checked.success) {
    return null;
  }
  const { pm2_5: pm25, pm10, nitrogen_dioxide: no2, time } = checked.data.current;
  const roundedPm25 = round2(pm25);
  const roundedPm10 = pm10 !== undefined ? round2(pm10) : undefined;
  const roundedNo2 = no2 !== undefined ? round2(no2) : undefined;
  const observedAt = normalizeObservedAt(time);
  const cpcb = computeCpcbAqi(roundedPm25, roundedPm10, roundedNo2);
  return {
    pm25: roundedPm25,
    ...(roundedPm10 !== undefined ? { pm10: roundedPm10 } : {}),
    ...(roundedNo2 !== undefined ? { no2: roundedNo2 } : {}),
    ...(observedAt !== undefined ? { observedAt } : {}),
    cpcbAqi: cpcb.aqi,
    dominantPollutant: cpcb.dominantPollutant,
  };
}

async function fetchOpenMeteo(lat: number, lon: number): Promise<LiveAqSnapshot | null> {
  const payload = await fetchBoundedJson(buildOpenMeteoUrl(lat, lon), FETCH_TIMEOUT_MS);
  const liveAq = payload === null ? null : parseLiveAqPayload(payload);
  return liveAq === null ? null : { liveAq, fetchedAt: new Date().toISOString() };
}

function fetchSharedSnapshot(
  cache: typeof presetAqCache,
  cacheKey: string,
  lat: number,
  lon: number,
): Promise<LiveAqSnapshot | null> {
  return aqSingleflight.run(cacheKey, async () => {
    const snapshot = await fetchOpenMeteo(lat, lon);
    if (snapshot !== null) {
      cache.set(cacheKey, snapshot);
    }
    return snapshot;
  });
}

function buildLiveLookup(
  city: CityPreset,
  snapshot: LiveAqSnapshot,
  cached: boolean,
): AirQualityLookupResult {
  const { liveAq, fetchedAt } = snapshot;
  const pm25 = String(Math.round(liveAq.pm25));
  const result = buildLookupResult(city, {
    ...liveAq,
    sourceLabel: `Open-Meteo Live AQ (${city.name}: PM2.5 ${pm25} ug/m3)`,
  });
  return { ...result, cached, fetchedAt };
}

/** Fetches live Open-Meteo AQ metrics for a validated city preset ID with 15-min LRU caching. */
export async function fetchAirQualityForCity(rawCityId: string): Promise<AirQualityLookupResult> {
  const safeId = isUnsafeCityInput(rawCityId) ? 'delhi_anand_vihar' : rawCityId;
  const preset = resolveCityPreset(safeId);
  const cacheKey = hashCacheKey({ service: 'open-meteo-preset', cityId: preset.id });
  const cached = presetAqCache.get(cacheKey);
  if (cached !== undefined) {
    return buildLiveLookup(preset, cached, true);
  }
  const snapshot = await fetchSharedSnapshot(presetAqCache, cacheKey, preset.lat, preset.lon);
  return snapshot === null
    ? buildLookupResult(preset, null)
    : buildLiveLookup(preset, snapshot, false);
}

/** Fetches live Open-Meteo AQ metrics for custom Indian coordinates with <= 50 km fallback. */
export async function fetchAirQualityForCoords(
  input: CoordinateAqInput,
): Promise<AirQualityLookupResult> {
  const gridLat = quantizeGrid(input.lat);
  const gridLon = quantizeGrid(input.lon);
  const cacheKey = hashCacheKey({ service: 'open-meteo-coords', gridLat, gridLon });
  const nearest = findNearestIndianPreset(input.lat, input.lon);
  const syntheticCity = buildSyntheticCityPreset(input, nearest.preset);
  const cached = customAqCache.get(cacheKey);
  if (cached !== undefined) {
    return buildLiveLookup(syntheticCity, cached, true);
  }
  const snapshot = await fetchSharedSnapshot(customAqCache, cacheKey, gridLat, gridLon);
  if (snapshot !== null) {
    return buildLiveLookup(syntheticCity, snapshot, false);
  }
  if (nearest.distanceKm > MAX_FALLBACK_DISTANCE_KM) {
    throw new LiveAqUnavailableError();
  }
  return buildNearestFallbackResult(syntheticCity, nearest.preset, nearest.distanceKm);
}

/** Clears preset, custom coordinate, and in-flight Open-Meteo AQ caches. */
export function clearAirQualityCache(): void {
  presetAqCache.clear();
  customAqCache.clear();
  aqSingleflight.clear();
}
