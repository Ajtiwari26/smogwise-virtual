/**
 * Custom city resolution, live Open-Meteo AQ override merging, GRAP mapping,
 * and deterministic citation builders. Pure TypeScript with zero Node/DOM deps.
 */

import {
  findNearestCityPresetWithDistance,
  MAX_FALLBACK_DISTANCE_KM,
  resolveCityPreset,
} from './cityPresets.js';
import { INDOOR_PRACTICAL_TARGET_UG_M3 } from './constants.js';
import { round1, round2 } from './domainUtils.js';
import type {
  AqResolutionStatus,
  CityPreset,
  EmissionsMetrics,
  ExposureMetrics,
  GRAPStage,
  LiveAqOverride,
  UserProfile,
} from './types.js';

/** Live or preset air-quality resolution outcome. */
interface LiveAqResolution {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly livePm10?: number;
  readonly liveNo2?: number;
}

/** Returns true when two profiles resolve to the same AQ city preset or coordinate pair. */
export function isSameLocationTarget(a: UserProfile, b: UserProfile): boolean {
  if (a.customLocation !== undefined || b.customLocation !== undefined) {
    return (
      a.customLocation !== undefined &&
      b.customLocation !== undefined &&
      a.customLocation.lat === b.customLocation.lat &&
      a.customLocation.lon === b.customLocation.lon
    );
  }
  return resolveCityPreset(a.cityId).id === resolveCityPreset(b.cityId).id;
}

/** Derives a GRAP stage consistent with CPCB winter PM2.5 preset thresholds. */
export function deriveGrapStageFromPm25(pm25: number): GRAPStage {
  if (pm25 >= 250) return 'GRAP_IV';
  if (pm25 >= 200) return 'GRAP_III';
  if (pm25 >= 150) return 'GRAP_II';
  if (pm25 >= 90) return 'GRAP_I';
  return 'NONE';
}

function slugifyLocationName(name: string): string {
  const slug = name
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length >= 2 ? slug.slice(0, 48) : 'custom_location';
}

function sanitizeDomainLabel(raw: string | undefined): string {
  if (raw === undefined) return '';
  return raw
    .normalize('NFKC')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/[[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveBaseLocation(profile: UserProfile): {
  readonly city: CityPreset;
  readonly proxyStationName?: string;
  readonly proxyDistanceKm?: number;
} {
  const custom = profile.customLocation;
  if (custom === undefined) return { city: resolveCityPreset(profile.cityId) };
  const nearest = findNearestCityPresetWithDistance(custom.lat, custom.lon);
  const nearestPreset = nearest.preset;
  const cleanName = sanitizeDomainLabel(custom.name) || nearestPreset.name;
  const cleanState = sanitizeDomainLabel(custom.state);
  const displayState = cleanState.length > 0 ? cleanState : nearestPreset.state;
  const displayName = cleanState.length > 0 ? `${cleanName}, ${cleanState}` : cleanName;
  const safeLat = Number.isFinite(custom.lat) ? custom.lat : nearestPreset.lat;
  const safeLon = Number.isFinite(custom.lon) ? custom.lon : nearestPreset.lon;

  return {
    proxyStationName: nearestPreset.name,
    proxyDistanceKm: nearest.distanceKm,
    city: {
      ...nearestPreset,
      id: `custom_${slugifyLocationName(cleanName)}`,
      name: displayName,
      nameHi: displayName,
      state: displayState,
      lat: safeLat,
      lon: safeLon,
    },
  };
}

/** Resolves the effective CityPreset (or custom Indian coordinate city) for a profile. */
export function resolveBaseCity(profile: UserProfile): CityPreset {
  return resolveBaseLocation(profile).city;
}

function sanitizeOptionalPollutant(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) return undefined;
  return round2(value);
}

function buildOverriddenCity(
  preset: CityPreset,
  pm25: number,
  pm10: number | undefined,
  no2: number | undefined,
  isFallback: boolean,
): CityPreset {
  return {
    ...preset,
    baselinePm25: pm25,
    baselinePm10: pm10 ?? (isFallback ? preset.baselinePm10 : 0),
    baselineNo2: no2 ?? (isFallback ? preset.baselineNo2 : 0),
    grapStage: isFallback ? preset.grapStage : deriveGrapStageFromPm25(pm25),
  };
}

/** Applies a live Open-Meteo AQ override without leaking stale preset pollutants. */
export function applyLiveAqOverride(
  preset: CityPreset,
  liveAq?: LiveAqOverride,
): LiveAqResolution {
  if (liveAq === undefined || !Number.isFinite(liveAq.pm25) || liveAq.pm25 < 0) {
    return { city: preset, dataSource: 'city_preset' };
  }
  const effectivePm10 = sanitizeOptionalPollutant(liveAq.pm10);
  const effectiveNo2 = sanitizeOptionalPollutant(liveAq.no2);
  const isFallback = liveAq.fallbackStationName !== undefined;
  const city = buildOverriddenCity(
    preset, round2(liveAq.pm25), effectivePm10, effectiveNo2, isFallback,
  );
  return {
    city,
    dataSource: isFallback ? 'city_preset' : 'live_open_meteo',
    ...(effectivePm10 !== undefined ? { livePm10: effectivePm10 } : {}),
    ...(effectiveNo2 !== undefined ? { liveNo2: effectiveNo2 } : {}),
  };
}

function formatIndoorTargetCitation(indoorPm25: number): string {
  const target = String(INDOOR_PRACTICAL_TARGET_UG_M3);
  if (indoorPm25 <= INDOOR_PRACTICAL_TARGET_UG_M3) {
    return `${String(indoorPm25)} ug/m3 meets <= ${target} ug/m3 practical indoor target (India NAAQS 24h: 60 ug/m3)`;
  }
  const gap = round2(indoorPm25 - INDOOR_PRACTICAL_TARGET_UG_M3);
  return `${String(indoorPm25)} ug/m3 (${String(gap)} ug/m3 above ${target} ug/m3 practical target)`;
}

function formatEmissionsCitation(co2eAvoidedGramsPerDay: number): string {
  if (co2eAvoidedGramsPerDay >= 0) return `${String(co2eAvoidedGramsPerDay)} g CO2e/day avoided`;
  return `+${String(Math.abs(co2eAvoidedGramsPerDay))} g CO2e/day above baseline`;
}

/** Builds deterministic citation keys grounded in Tier 1 calculation metrics. */
export function buildCitations(
  city: CityPreset,
  dataSource: 'live_open_meteo' | 'city_preset',
  exposure: ExposureMetrics,
  emissions: EmissionsMetrics,
  sourceLabel?: string,
  aqStatus?: AqResolutionStatus,
): Readonly<Record<string, string>> {
  const aqSourceText = sourceLabel ?? (
    dataSource === 'live_open_meteo'
      ? `Open-Meteo Live AQ (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`
      : `Offline City Preset (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`
  );
  const shared = {
    'CALC:CO2E_SAVED': formatEmissionsCitation(emissions.co2eAvoidedGramsPerDay),
    'CALC:INR_DELTA': `INR ${String(emissions.monthlyNetSavingsInr)}/month net savings`,
    'AQ:SOURCE': aqSourceText,
    'SCI:PLANTS_VS_HEPA': 'HEPA/CR-box CADR cuts PM2.5; potted plants remove negligible PM2.5',
  };
  if (aqStatus === 'unavailable') return shared;
  return {
    'CALC:DOSE_BEFORE': `${String(exposure.baselineInhaledUgPerDay)} ug/day baseline inhaled PM2.5`,
    'CALC:DOSE_AFTER': `${String(exposure.optimizedInhaledUgPerDay)} ug/day optimized inhaled PM2.5`,
    'CALC:INDOOR_PM25':
      `${String(exposure.baselineIndoorPm25)} -> ${String(exposure.optimizedIndoorPm25)} ug/m3 indoor PM2.5`,
    'CALC:INDOOR_TARGET': formatIndoorTargetCitation(exposure.optimizedIndoorPm25),
    ...shared,
  };
}

function resolveAqStatus(
  isCustom: boolean,
  dataSource: 'live_open_meteo' | 'city_preset',
  distanceKm: number | undefined,
): AqResolutionStatus {
  if (dataSource === 'live_open_meteo') return 'live';
  if (!isCustom) return 'nearby_proxy';
  return distanceKm !== undefined && distanceKm > MAX_FALLBACK_DISTANCE_KM
    ? 'unavailable'
    : 'nearby_proxy';
}

function buildSourceLabel(
  status: AqResolutionStatus,
  fallbackStationName: string | undefined,
  fallbackDistanceKm: number | undefined,
  cityPm25: number,
  liveLabel: string | undefined,
): string | undefined {
  if (status === 'live') return liveLabel;
  if (status === 'unavailable' && fallbackStationName !== undefined) {
    const km = fallbackDistanceKm !== undefined ? `${String(fallbackDistanceKm)} km` : '>50 km';
    return `Live AQ unavailable (${km} from ${fallbackStationName})`;
  }
  return fallbackStationName !== undefined
    ? `Nearest station proxy: ${fallbackStationName} (PM2.5 ${String(cityPm25)} ug/m3)`
    : undefined;
}

function buildFallbackMetadata(
  base: ReturnType<typeof resolveBaseLocation>,
  resolved: LiveAqResolution,
  liveAq?: LiveAqOverride,
) {
  if (resolved.dataSource !== 'city_preset') return {};
  const fallbackStationName = liveAq?.fallbackStationName ?? base.proxyStationName;
  const distance = liveAq?.fallbackDistanceKm ?? base.proxyDistanceKm;
  return {
    fallbackStationName,
    fallbackDistanceKm: distance === undefined ? undefined : round1(distance),
  };
}

/** Resolves the profile's plan data and enforces shared <=50 km fallback status. */
export function resolveReportAq(profile: UserProfile, liveAq?: LiveAqOverride) {
  const base = resolveBaseLocation(profile);
  const resolved = applyLiveAqOverride(base.city, liveAq);
  const observedAt = liveAq?.observedAt;
  const { fallbackStationName, fallbackDistanceKm } = buildFallbackMetadata(base, resolved, liveAq);
  const aqStatus = resolveAqStatus(
    profile.customLocation !== undefined, resolved.dataSource, base.proxyDistanceKm,
  );
  const sourceLabel = buildSourceLabel(
    aqStatus, fallbackStationName, fallbackDistanceKm,
    resolved.city.baselinePm25, liveAq?.sourceLabel,
  );
  const observationId = buildObservationId(resolved.city, aqStatus, observedAt);
  return {
    ...resolved, observationId, aqStatus, sourceLabel,
    ...(observedAt !== undefined ? { observedAt } : {}),
    ...(fallbackStationName !== undefined ? { fallbackStationName } : {}),
    ...(fallbackDistanceKm !== undefined ? { fallbackDistanceKm } : {}),
  };
}

/** Identifies a location and the exact pollutant snapshot used for its calculations. */
export function buildObservationId(
  city: CityPreset,
  status: AqResolutionStatus,
  observedAt?: string,
): string {
  return JSON.stringify([
    city.lat, city.lon, status, observedAt ?? null,
    city.baselinePm25, city.baselinePm10, city.baselineNo2,
  ]);
}
