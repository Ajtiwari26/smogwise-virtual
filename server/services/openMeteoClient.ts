/**
 * SSRF-safe Open-Meteo Air Quality client with partitioned LRU caches,
 * bounded singleflight coalescing, CPCB NAQI scoring, and <= 50 km fallback.
 */

import { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import type { LiveAqOverride } from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { isUnsafeCityInput } from '../middleware/locationGuard.js';
import {
  buildLookupResult,
  buildNearestFallbackResult,
  buildSyntheticCityPreset,
  findNearestIndianPreset,
  normalizeObservedAt,
} from './openMeteoHelpers.js';
import type { AirQualityLookupResult, CoordinateAqInput } from './openMeteoHelpers.js';

export { isUnsafeCityInput };
export type { AirQualityLookupResult, CoordinateAqInput };

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
  readonly code = 'LIVE_AQ_UNAVAILABLE' as const;

  constructor(message = 'Live air quality data is temporarily unavailable for this location.') {
    super(message);
    this.name = 'LiveAqUnavailableError';
  }
}

const presetAqCache = createLruCache<AirQualityLookupResult>(32, CACHE_TTL_MS);
const customAqCache = createLruCache<AirQualityLookupResult>(128, CACHE_TTL_MS);
const aqSingleflight = createSingleflight<AirQualityLookupResult>(100);

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

function parseLiveAqPayload(payload: unknown, cityName: string): LiveAqOverride | null {
  const checked = OpenMeteoResponseSchema.safeParse(payload);
  if (!checked.success) {
    return null;
  }
  const { pm2_5: pm25, pm10, nitrogen_dioxide: no2, time } = checked.data.current;
  const roundedPm25 = Math.round(pm25 * 100) / 100;
  const roundedPm10 = pm10 !== undefined ? Math.round(pm10 * 100) / 100 : undefined;
  const roundedNo2 = no2 !== undefined ? Math.round(no2 * 100) / 100 : undefined;
  const observedAt = normalizeObservedAt(time);
  const cpcb = computeCpcbAqi(roundedPm25, roundedPm10, roundedNo2);
  return {
    pm25: roundedPm25,
    ...(roundedPm10 !== undefined ? { pm10: roundedPm10 } : {}),
    ...(roundedNo2 !== undefined ? { no2: roundedNo2 } : {}),
    sourceLabel: `Open-Meteo Live AQ (${cityName}: PM2.5 ${String(Math.round(pm25))} ug/m3)`,
    ...(observedAt !== undefined ? { observedAt } : {}),
    cpcbAqi: cpcb.aqi,
    dominantPollutant: cpcb.dominantPollutant,
  };
}

async function fetchOpenMeteo(
  lat: number,
  lon: number,
  label: string,
): Promise<LiveAqOverride | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildOpenMeteoUrl(lat, lon), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    return parseLiveAqPayload(payload, label);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches live Open-Meteo AQ metrics for a validated city preset ID with 15-min LRU caching. */
export async function fetchAirQualityForCity(rawCityId: string): Promise<AirQualityLookupResult> {
  const safeId = isUnsafeCityInput(rawCityId) ? 'delhi_anand_vihar' : rawCityId;
  const preset = resolveCityPreset(safeId);
  const cacheKey = hashCacheKey({ service: 'open-meteo-preset', cityId: preset.id });
  const cached = presetAqCache.get(cacheKey);
  if (cached !== undefined) {
    return { ...cached, cached: true };
  }
  return aqSingleflight.run(cacheKey, async () => {
    const liveAq = await fetchOpenMeteo(preset.lat, preset.lon, preset.name);
    const result = buildLookupResult(preset, liveAq);
    if (liveAq !== null) {
      presetAqCache.set(cacheKey, result, CACHE_TTL_MS);
    }
    return result;
  });
}

function withCallerCity(
  result: AirQualityLookupResult,
  syntheticCity: ReturnType<typeof buildSyntheticCityPreset>,
  isCacheHit: boolean,
): AirQualityLookupResult {
  const live = result.liveAq;
  const refreshedLive =
    live !== undefined && live.fallbackStationName === undefined
      ? {
          ...live,
          sourceLabel: `Open-Meteo Live AQ (${syntheticCity.name}: PM2.5 ${String(Math.round(live.pm25))} ug/m3)`,
        }
      : live;
  return {
    ...result,
    city: syntheticCity,
    ...(refreshedLive !== undefined ? { liveAq: refreshedLive } : {}),
    ...(isCacheHit ? { cached: true } : {}),
  };
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
    return withCallerCity(cached, syntheticCity, true);
  }
  const result = await aqSingleflight.run(cacheKey, async () => {
    const liveAq = await fetchOpenMeteo(input.lat, input.lon, syntheticCity.name);
    if (liveAq !== null) {
      const liveResult = buildLookupResult(syntheticCity, liveAq);
      customAqCache.set(cacheKey, liveResult, CACHE_TTL_MS);
      return liveResult;
    }
    if (nearest.distanceKm > MAX_FALLBACK_DISTANCE_KM) {
      throw new LiveAqUnavailableError();
    }
    return buildNearestFallbackResult(syntheticCity, nearest.preset, nearest.distanceKm);
  });
  return result.city.id === syntheticCity.id
    ? result
    : withCallerCity(result, syntheticCity, false);
}

/** Clears preset, custom coordinate, and in-flight Open-Meteo AQ caches. */
export function clearAirQualityCache(): void {
  presetAqCache.clear();
  customAqCache.clear();
  aqSingleflight.clear();
}