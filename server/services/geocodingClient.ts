/**
 * SSRF-safe Open-Meteo Geocoding client restricted to India (countryCode=IN)
 * with 3.5s AbortController timeout, bounded JSON fetch, singleflight coalescing,
 * 24h LRU caching, and curated preset fallback.
 */

import { z } from 'zod';
import { CITY_PRESETS, isWithinIndiaCoords } from '../../src/domain/cityPresets.js';
import { round2 } from '../../src/domain/domainUtils.js';
import type { LocationSearchItem } from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { sanitizeLocationText } from '../middleware/locationGuard.js';
import { fetchBoundedJson } from './httpFetch.js';

const OPEN_METEO_GEO_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const FETCH_TIMEOUT_MS = 3500;
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const GeocodingRawItemSchema = z.object({
  name: z.string().min(1),
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  admin1: z.string().optional(),
  country_code: z.string().optional(),
});

const GeocodingResponseSchema = z.object({
  results: z.array(GeocodingRawItemSchema).optional(),
  generationtime_ms: z.number().nonnegative().optional(),
  error: z.literal(false).optional(),
}).refine((data) => data.results !== undefined || data.generationtime_ms !== undefined);

const geoCache = createLruCache<readonly LocationSearchItem[]>(200, GEO_CACHE_TTL_MS);
const geoSingleflight = createSingleflight<readonly LocationSearchItem[] | null>(100);

function normalizeQueryKey(rawQuery: string): string {
  return rawQuery.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
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
  if (raw.country_code?.toUpperCase() !== 'IN') {
    return null;
  }
  if (!isWithinIndiaCoords(raw.latitude, raw.longitude)) {
    return null;
  }
  const name = sanitizeLocationText(raw.name);
  if (name.length === 0) {
    return null;
  }
  const sanitizedState = sanitizeLocationText(raw.admin1 ?? 'India');
  const state = sanitizedState.length > 0 ? sanitizedState : 'India';
  const lat = round2(raw.latitude);
  const lon = round2(raw.longitude);
  return {
    id: `in_${String(lat)}_${String(lon)}`,
    name,
    state,
    lat,
    lon,
  };
}

function parseGeocodingPayload(payload: unknown): readonly LocationSearchItem[] | null {
  const parsed = GeocodingResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  const mapped: LocationSearchItem[] = [];
  const seenIds = new Set<string>();
  for (const raw of parsed.data.results ?? []) {
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
    const hayName = preset.name.toLowerCase();
    const hayState = preset.state.toLowerCase();
    if (hayName.includes(needle) || hayState.includes(needle)) {
      matches.push({
        id: preset.id,
        name: preset.name,
        state: preset.state,
        lat: round2(preset.lat),
        lon: round2(preset.lon),
      });
    }
  }
  return matches.slice(0, 6);
}

async function fetchOpenMeteoGeocoding(
  cleanQuery: string,
): Promise<readonly LocationSearchItem[] | null> {
  const payload = await fetchBoundedJson(buildGeocodingUrl(cleanQuery), FETCH_TIMEOUT_MS);
  if (payload === null) {
    return null;
  }
  return parseGeocodingPayload(payload);
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
  const results = geoCache.get(cacheKey) ?? await geoSingleflight.run(cacheKey, async () => {
    const remoteResults = await fetchOpenMeteoGeocoding(cleanQuery);
    if (remoteResults !== null) {
      geoCache.set(cacheKey, remoteResults);
    }
    return remoteResults;
  });
  return results !== null && results.length > 0
    ? results
    : searchCuratedIndianPresets(cleanQuery);
}

/** Clears the in-memory geocoding LRU cache and in-flight map. */
export function clearGeocodingCache(): void {
  geoCache.clear();
  geoSingleflight.clear();
}
