/**
 * SSRF-safe Open-Meteo Air Quality client with partitioned LRU caches,
 * IST timestamp normalization, CPCB NAQI scoring, and <= 50 km Haversine fallback.
 */

import { z } from 'zod';
import { CITY_PRESETS, resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import type {
  AqiBandId,
  CityPreset,
  DominantPollutant,
  LiveAqOverride,
} from '../../src/domain/types.js';
import { createLruCache, hashCacheKey } from '../cache/lruCache.js';
import { sanitizeLocationText } from '../middleware/locationGuard.js';

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
const EARTH_RADIUS_KM = 6371;
const SAFE_CITY_RE = /^[A-Za-z0-9\s_().,-]{1,64}$/;
const URL_LIKE_RE = new RegExp(
  'https?:\\/\\/|file:\\/\\/|ftp:\\/\\/|169\\.254\\.|localhost|127\\.0\\.0\\.1|::1',
  'i',
);
const EXCLUDED_PRESET_IDS = new Set(['lahore_gulberg', 'salt_lake_city']);
const SHORT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const FULL_NAIVE_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** Error thrown when live AQ lookup fails and no Indian preset exists within 50 km. */
export class LiveAqUnavailableError extends Error {
  readonly code = 'LIVE_AQ_UNAVAILABLE' as const;

  constructor(message = 'Live air quality data is temporarily unavailable for this location.') {
    super(message);
    this.name = 'LiveAqUnavailableError';
  }
}

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

const presetAqCache = createLruCache<AirQualityLookupResult>(32, CACHE_TTL_MS);
const customAqCache = createLruCache<AirQualityLookupResult>(128, CACHE_TTL_MS);

/**
 * Returns true when a raw city query string looks like a URL, IP, or unsafe SSRF payload.
 */
export function isUnsafeCityInput(rawCity: string): boolean {
  const trimmed = rawCity.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (trimmed.includes('[') || trimmed.includes(']')) {
    return true;
  }
  if (URL_LIKE_RE.test(trimmed)) {
    return true;
  }
  return !SAFE_CITY_RE.test(trimmed);
}

/**
 * Normalizes an Open-Meteo timestamp string into an ISO-8601 IST (+05:30) timestamp.
 */
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

function clampCoord(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function quantizeGrid(value: number): number {
  return Math.round(value * 20) / 20;
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestIndianPreset(lat: number, lon: number): {
  readonly preset: CityPreset;
  readonly distanceKm: number;
} {
  let nearestPreset = CITY_PRESETS[0] as CityPreset;
  let minDistance = Number.POSITIVE_INFINITY;
  for (const preset of CITY_PRESETS) {
    if (EXCLUDED_PRESET_IDS.has(preset.id)) {
      continue;
    }
    const dist = haversineKm(lat, lon, preset.lat, preset.lon);
    if (dist < minDistance) {
      minDistance = dist;
      nearestPreset = preset;
    }
  }
  return { preset: nearestPreset, distanceKm: minDistance };
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
    const url = buildOpenMeteoUrl(lat, lon);
    const response = await fetch(url, {
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

interface LookupExtraMeta {
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
}

function resolveLookupMetrics(
  city: CityPreset,
  liveAq: LiveAqOverride | null,
): ReturnType<typeof computeCpcbAqi> {
  const pm25 = liveAq?.pm25 ?? city.baselinePm25;
  const pm10 = liveAq !== null ? liveAq.pm10 : city.baselinePm10;
  const no2 = liveAq !== null ? liveAq.no2 : city.baselineNo2;
  return computeCpcbAqi(pm25, pm10, no2);
}

function buildOptionalLookupFields(
  liveAq: LiveAqOverride | null,
  extra?: LookupExtraMeta,
): Pick<
  AirQualityLookupResult,
  'observedAt' | 'fallbackStationName' | 'fallbackDistanceKm' | 'liveAq'
> {
  return {
    ...(liveAq?.observedAt !== undefined ? { observedAt: liveAq.observedAt } : {}),
    ...(extra?.fallbackStationName !== undefined
      ? { fallbackStationName: extra.fallbackStationName }
      : {}),
    ...(extra?.fallbackDistanceKm !== undefined
      ? { fallbackDistanceKm: extra.fallbackDistanceKm }
      : {}),
    ...(liveAq !== null ? { liveAq } : {}),
  };
}

function buildLookupResult(
  city: CityPreset,
  liveAq: LiveAqOverride | null,
  extra?: LookupExtraMeta,
): AirQualityLookupResult {
  const cpcb = resolveLookupMetrics(city, liveAq);
  return {
    city,
    dataSource: liveAq !== null ? 'live_open_meteo' : 'city_preset',
    cpcbAqi: cpcb.aqi,
    aqiBand: cpcb.band,
    dominantPollutant: cpcb.dominantPollutant,
    ...buildOptionalLookupFields(liveAq, extra),
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

function buildSyntheticCityPreset(
  input: CoordinateAqInput,
  nearestPreset: CityPreset,
): CityPreset {
  const cleanName = sanitizeLocationText(input.name ?? '');
  const cleanState = sanitizeLocationText(input.state ?? '');
  const displayName = cleanName.length > 0 ? cleanName : `${nearestPreset.name} Area`;
  const displayState = cleanState.length > 0 ? cleanState : nearestPreset.state;
  const lat = Math.round(input.lat * 10000) / 10000;
  const lon = Math.round(input.lon * 10000) / 10000;

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

/**
 * Fetches live Open-Meteo AQ metrics for a validated city preset ID with 15-minute LRU caching,
 * falling back cleanly to the curated CityPreset when offline or timed out.
 */
export async function fetchAirQualityForCity(rawCityId: string): Promise<AirQualityLookupResult> {
  const safeId = isUnsafeCityInput(rawCityId) ? 'delhi_anand_vihar' : rawCityId;
  const preset = resolveCityPreset(safeId);
  const cacheKey = hashCacheKey({ service: 'open-meteo-preset', cityId: preset.id });
  const cached = presetAqCache.get(cacheKey);
  if (cached !== undefined) {
    return { ...cached, cached: true };
  }

  const liveAq = await fetchOpenMeteo(preset.lat, preset.lon, preset.name);
  const result = buildLookupResult(preset, liveAq);
  if (liveAq !== null) {
    presetAqCache.set(cacheKey, result, CACHE_TTL_MS);
  }
  return result;
}

/**
 * Fetches live Open-Meteo AQ metrics for custom Indian coordinates using a 0.05-degree
 * grid cache, falling back to the nearest Indian preset within 50 km or throwing
 * LiveAqUnavailableError when offline beyond 50 km.
 */
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
    return { ...cached, city: syntheticCity, cached: true };
  }

  const liveAq = await fetchOpenMeteo(input.lat, input.lon, syntheticCity.name);
  if (liveAq !== null) {
    const result = buildLookupResult(syntheticCity, liveAq);
    customAqCache.set(cacheKey, result, CACHE_TTL_MS);
    return result;
  }

  if (nearest.distanceKm > MAX_FALLBACK_DISTANCE_KM) {
    throw new LiveAqUnavailableError();
  }

  const roundedDist = Math.round(nearest.distanceKm * 10) / 10;
  const fallbackOverride: LiveAqOverride = {
    pm25: nearest.preset.baselinePm25,
    pm10: nearest.preset.baselinePm10,
    no2: nearest.preset.baselineNo2,
    sourceLabel: `Nearest station fallback: ${nearest.preset.name} (${String(Math.round(nearest.distanceKm))} km away)`,
    fallbackStationName: nearest.preset.name,
    fallbackDistanceKm: roundedDist,
  };
  const cpcb = computeCpcbAqi(
    nearest.preset.baselinePm25,
    nearest.preset.baselinePm10,
    nearest.preset.baselineNo2,
  );
  return {
    city: syntheticCity,
    dataSource: 'city_preset',
    cpcbAqi: cpcb.aqi,
    aqiBand: cpcb.band,
    dominantPollutant: cpcb.dominantPollutant,
    fallbackStationName: nearest.preset.name,
    fallbackDistanceKm: roundedDist,
    liveAq: fallbackOverride,
    fetchedAt: new Date().toISOString(),
    cached: false,
  };
}

/**
 * Clears both preset and custom coordinate Open-Meteo LRU caches.
 */
export function clearAirQualityCache(): void {
  presetAqCache.clear();
  customAqCache.clear();
}
