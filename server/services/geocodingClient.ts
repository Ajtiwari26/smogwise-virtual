/**
 * SSRF-safe Open-Meteo Geocoding client restricted to India (countryCode=IN)
 * with 3.5s AbortController timeout, singleflight coalescing, 24h LRU caching,
 * and curated preset fallback.
 */

import { z } from 'zod';
import { CITY_PRESETS } from '../../src/domain/cityPresets.js';
import type { LocationSearchItem } from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { sanitizeLocationText } from '../middleware/locationGuard.js';

const OPEN_METEO_GEO_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FETCH_TIMEOUT_MS = 3500;
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const INDIA_LAT_MIN = 6.5;
const INDIA_LAT_MAX = 37.5;
const INDIA_LON_MIN = 68.0;
const INDIA_LON_MAX = 97.5;

const EXCLUDED_PRESET_IDS = new Set(['lahore_gulberg', 'salt_lake_city']);

const GeocodingRawItemSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  admin1: z.string().optional(),
  country_code: z.string().optional(),
});

const GeocodingResponseSchema = z.object({
  results: z.array(GeocodingRawItemSchema).optional().default([]),
});

const geoCache = createLruCache<readonly LocationSearchItem[]>(200, GEO_CACHE_TTL_MS);
const geoSingleflight = createSingleflight<readonly LocationSearchItem[]>(100);

function normalizeQueryKey(rawQuery: string): string {
  return rawQuery.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function isInsideIndia(lat: number, lon: number): boolean {
  return (
    lat >= INDIA_LAT_MIN &&
    lat <= INDIA_LAT_MAX &&
    lon >= INDIA_LON_MIN &&
    lon <= INDIA_LON_MAX
  );
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildGeocodingUrl(cleanQuery: string): string {
  const params = new URLSearchParams({
    name: cleanQuery,
    countryCode: 'IN',
    count: '6',
    language: 'en',
    format: 'json',
  });
  return `${OPEN_METEO_GEO_ENDPOINT}?${params.toString()}`;
}

function mapRawResult(raw: z.infer<typeof GeocodingRawItemSchema>): LocationSearchItem | null {
  if (raw.country_code !== undefined && raw.country_code.toUpperCase() !== 'IN') {
    return null;
  }
  if (!isInsideIndia(raw.latitude, raw.longitude)) {
    return null;
  }
  const name = sanitizeLocationText(raw.name);
  if (name.length === 0) {
    return null;
  }
  const sanitizedState = sanitizeLocationText(raw.admin1 ?? 'India');
  const state = sanitizedState.length > 0 ? sanitizedState : 'India';
  const lat = roundTwoDecimals(raw.latitude);
  const lon = roundTwoDecimals(raw.longitude);
  return {
    id: `in_${String(lat)}_${String(lon)}`,
    name,
    state,
    lat,
    lon,
  };
}

function parseGeocodingPayload(payload: unknown): readonly LocationSearchItem[] {
  const parsed = GeocodingResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return [];
  }
  const mapped: LocationSearchItem[] = [];
  const seenIds = new Set<string>();
  for (const raw of parsed.data.results) {
    const item = mapRawResult(raw);
    if (item !== null && !seenIds.has(item.id)) {
      seenIds.add(item.id);
      mapped.push(item);
    }
  }
  return mapped;
}

function searchCuratedIndianPresets(cleanQuery: string): readonly LocationSearchItem[] {
  const needle = normalizeQueryKey(cleanQuery);
  const matches: LocationSearchItem[] = [];
  for (const preset of CITY_PRESETS) {
    if (EXCLUDED_PRESET_IDS.has(preset.id)) {
      continue;
    }
    const hayName = preset.name.toLowerCase();
    const hayState = preset.state.toLowerCase();
    if (hayName.includes(needle) || hayState.includes(needle)) {
      matches.push({
        id: preset.id,
        name: preset.name,
        state: preset.state,
        lat: roundTwoDecimals(preset.lat),
        lon: roundTwoDecimals(preset.lon),
      });
    }
  }
  return matches.slice(0, 6);
}

async function fetchOpenMeteoGeocoding(
  cleanQuery: string,
): Promise<readonly LocationSearchItem[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(buildGeocodingUrl(cleanQuery), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    const payload: unknown = await response.json();
    return parseGeocodingPayload(payload);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Searches Indian cities via Open-Meteo Geocoding with 24h LRU & singleflight caching. */
export async function searchIndianLocations(
  query: string,
): Promise<readonly LocationSearchItem[]> {
  const cleanQuery = sanitizeLocationText(query);
  if (cleanQuery.length < 2) {
    return [];
  }
  const cacheKey = hashCacheKey({ service: 'open-meteo-geo', q: normalizeQueryKey(cleanQuery) });
  const cached = geoCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  return geoSingleflight.run(cacheKey, async () => {
    const remoteResults = await fetchOpenMeteoGeocoding(cleanQuery);
    if (remoteResults !== null) {
      geoCache.set(cacheKey, remoteResults, GEO_CACHE_TTL_MS);
      return remoteResults;
    }
    return searchCuratedIndianPresets(cleanQuery);
  });
}

/** Clears the in-memory geocoding LRU cache and in-flight map. */
export function clearGeocodingCache(): void {
  geoCache.clear();
  geoSingleflight.clear();
}