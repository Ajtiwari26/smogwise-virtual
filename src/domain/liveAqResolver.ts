/**
 * Custom city resolution, live Open-Meteo AQ override merging, GRAP mapping,
 * and deterministic citation builders. Pure TypeScript with zero Node/DOM deps.
 */

import { findNearestCityPreset, resolveCityPreset } from './cityPresets.js';
import { INDOOR_PRACTICAL_TARGET_UG_M3 } from './constants.js';
import { round2, round4 } from './domainUtils.js';
import type {
  CityPreset,
  DeterministicReport,
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
  if (pm25 >= 250) {
    return 'GRAP_IV';
  }
  if (pm25 >= 200) {
    return 'GRAP_III';
  }
  if (pm25 >= 150) {
    return 'GRAP_II';
  }
  if (pm25 >= 90) {
    return 'GRAP_I';
  }
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
  if (raw === undefined) {
    return '';
  }
  return raw
    .normalize('NFKC')
    .replace(/<[^<>]*>/g, ' ')
    .replace(/[[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveBaseLocation(
  profile: UserProfile,
): { readonly city: CityPreset; readonly proxyStationName?: string } {
  const custom = profile.customLocation;
  if (custom === undefined) {
    return { city: resolveCityPreset(profile.cityId) };
  }
  const nearestPreset = findNearestCityPreset(custom.lat, custom.lon);
  const cleanName = sanitizeDomainLabel(custom.name) || nearestPreset.name;
  const cleanState = sanitizeDomainLabel(custom.state);
  const displayState = cleanState.length > 0 ? cleanState : nearestPreset.state;
  const displayName = cleanState.length > 0 ? `${cleanName}, ${cleanState}` : cleanName;
  const safeLat = Number.isFinite(custom.lat) ? round4(custom.lat) : nearestPreset.lat;
  const safeLon = Number.isFinite(custom.lon) ? round4(custom.lon) : nearestPreset.lon;

  return {
    proxyStationName: nearestPreset.name,
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
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
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
    preset,
    round2(liveAq.pm25),
    effectivePm10,
    effectiveNo2,
    isFallback,
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
  const concentration = String(indoorPm25);
  if (indoorPm25 <= INDOOR_PRACTICAL_TARGET_UG_M3) {
    return `${concentration} ug/m3 meets <= ${target} ug/m3 practical indoor target ` +
      '(India NAAQS 24h: 60 ug/m3)';
  }
  const gap = round2(indoorPm25 - INDOOR_PRACTICAL_TARGET_UG_M3);
  return `${concentration} ug/m3 (${String(gap)} ug/m3 above ${target} ug/m3 practical target)`;
}

/** Builds deterministic citation keys grounded in Tier 1 calculation metrics. */
export function buildCitations(
  city: CityPreset,
  dataSource: 'live_open_meteo' | 'city_preset',
  exposure: ExposureMetrics,
  emissions: EmissionsMetrics,
  sourceLabel?: string,
): Readonly<Record<string, string>> {
  const aqSourceText = sourceLabel ?? (
    dataSource === 'live_open_meteo'
      ? `Open-Meteo Live AQ (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`
      : `Offline City Preset (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`
  );

  return {
    'CALC:DOSE_BEFORE': `${String(exposure.baselineInhaledUgPerDay)} ug/day baseline inhaled PM2.5`,
    'CALC:DOSE_AFTER': `${String(exposure.optimizedInhaledUgPerDay)} ug/day optimized inhaled PM2.5`,
    'CALC:INDOOR_PM25': `${String(exposure.baselineIndoorPm25)} -> ${String(exposure.optimizedIndoorPm25)} ug/m3 indoor PM2.5`,
    'CALC:INDOOR_TARGET': formatIndoorTargetCitation(exposure.optimizedIndoorPm25),
    'CALC:CO2E_SAVED': `${String(emissions.co2eAvoidedGramsPerDay)} g CO2e/day avoided`,
    'CALC:INR_DELTA': `INR ${String(emissions.monthlyNetSavingsInr)}/month net savings`,
    'AQ:SOURCE': aqSourceText,
    'SCI:PLANTS_VS_HEPA': 'HEPA/CR-box CADR cuts PM2.5; potted plants remove negligible PM2.5',
  };
}

/** Extracts optional timestamp and fallback provenance metadata from LiveAqOverride. */
function resolveOptionalMetadata(
  liveAq?: LiveAqOverride,
): Pick<DeterministicReport, 'observedAt' | 'fallbackStationName' | 'fallbackDistanceKm'> {
  return {
    ...(liveAq?.observedAt !== undefined ? { observedAt: liveAq.observedAt } : {}),
    ...(liveAq?.fallbackStationName !== undefined
      ? { fallbackStationName: liveAq.fallbackStationName }
      : {}),
    ...(liveAq?.fallbackDistanceKm !== undefined
      ? { fallbackDistanceKm: liveAq.fallbackDistanceKm }
      : {}),
  };
}

/** Resolves the profile's plan data and names the source of any custom-location preset proxy. */
export function resolveReportAq(profile: UserProfile, liveAq?: LiveAqOverride) {
  const base = resolveBaseLocation(profile);
  const resolved = applyLiveAqOverride(base.city, liveAq);
  const metadata = resolveOptionalMetadata(liveAq);
  const fallbackStationName = metadata.fallbackStationName ??
    (resolved.dataSource === 'city_preset' ? base.proxyStationName : undefined);
  return {
    ...resolved,
    ...metadata,
    ...(fallbackStationName !== undefined ? { fallbackStationName } : {}),
    sourceLabel: fallbackStationName !== undefined
      ? `Nearest station proxy: ${fallbackStationName} (PM2.5 ${String(resolved.city.baselinePm25)} ug/m3)`
      : resolved.dataSource === 'live_open_meteo' ? liveAq?.sourceLabel : undefined,
  };
}
