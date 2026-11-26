/**
 * Facade orchestrating deterministic exposure, emissions, citations, and what-if plans.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import { resolveCityPreset } from './cityPresets.js';
import { computeCpcbAqi } from './cpcbAqi.js';
import {
  computeEmissionsMetrics,
  computeRawDailyEmissions,
  rankIAQHacksByBudget,
} from './emissionsEngine.js';
import { computeExposureMetrics } from './exposureEngine.js';
import {
  buildRwaNotice,
  formatLocalizedSummary,
  formatWhatIfExplanation,
  generateDailyRoutine,
} from './i18n.js';
import type {
  CityPreset,
  DeterministicReport,
  EmissionsMetrics,
  ExposureMetrics,
  FullPlanOutput,
  GRAPStage,
  LiveAqOverride,
  UserProfile,
  WhatIfComparisonResult,
  WhatIfDelta,
} from './types.js';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveGrapStageFromPm25(pm25: number): GRAPStage {
  if (pm25 >= 250) {
    return 'GRAP_IV';
  }
  if (pm25 >= 180) {
    return 'GRAP_III';
  }
  if (pm25 >= 120) {
    return 'GRAP_II';
  }
  if (pm25 >= 60) {
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

function resolveBaseCity(profile: UserProfile): CityPreset {
  const basePreset = resolveCityPreset(profile.cityId);
  const custom = profile.customLocation;
  if (custom === undefined) {
    return basePreset;
  }
  const cleanName = custom.name.normalize('NFKC').trim();
  const displayName =
    custom.state !== undefined && custom.state.trim().length > 0
      ? `${cleanName}, ${custom.state.normalize('NFKC').trim()}`
      : cleanName;
  return {
    ...basePreset,
    id: `custom_${slugifyLocationName(cleanName)}`,
    name: displayName,
    nameHi: displayName,
    lat: custom.lat,
    lon: custom.lon,
  };
}

interface LiveAqResolution {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly livePm10?: number;
  readonly liveNo2?: number;
}

function sanitizeOptionalPollutant(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return round2(value);
}

function applyLiveAqOverride(
  preset: CityPreset,
  liveAq?: LiveAqOverride,
): LiveAqResolution {
  if (liveAq === undefined || !Number.isFinite(liveAq.pm25) || liveAq.pm25 < 0) {
    return { city: preset, dataSource: 'city_preset' };
  }
  const normalizedPm25 = round2(liveAq.pm25);
  const effectivePm10 = sanitizeOptionalPollutant(liveAq.pm10);
  const effectiveNo2 = sanitizeOptionalPollutant(liveAq.no2);
  const dataSource =
    liveAq.fallbackStationName !== undefined ? 'city_preset' : 'live_open_meteo';
  const city: CityPreset = {
    ...preset,
    baselinePm25: normalizedPm25,
    baselinePm10: effectivePm10 ?? preset.baselinePm10,
    baselineNo2: effectiveNo2 ?? preset.baselineNo2,
    grapStage: deriveGrapStageFromPm25(normalizedPm25),
  };
  return {
    city,
    dataSource,
    ...(effectivePm10 !== undefined ? { livePm10: effectivePm10 } : {}),
    ...(effectiveNo2 !== undefined ? { liveNo2: effectiveNo2 } : {}),
  };
}

const INDOOR_WHO_TARGET_UG_M3 = 30;

function formatIndoorTargetCitation(indoorPm25: number): string {
  const gap = round2(Math.max(0, indoorPm25 - INDOOR_WHO_TARGET_UG_M3));
  if (gap === 0) {
    return `${String(indoorPm25)} ug/m3 meets < 30 ug/m3 safe indoor target`;
  }
  return `${String(indoorPm25)} ug/m3 (${String(gap)} ug/m3 above < 30 ug/m3 target)`;
}

function buildCitations(
  city: CityPreset,
  dataSource: 'live_open_meteo' | 'city_preset',
  exposure: ExposureMetrics,
  emissions: EmissionsMetrics,
  sourceLabel?: string,
): Readonly<Record<string, string>> {
  const aqSourceText =
    dataSource === 'live_open_meteo'
      ? (sourceLabel ?? `Open-Meteo Live AQ (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`)
      : `Offline City Preset (${city.name}: PM2.5 ${String(city.baselinePm25)} ug/m3)`;

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

/**
 * Computes the core deterministic Tier 1 exposure, emissions, and citations report.
 */
export function computeDeterministicReport(
  profile: UserProfile,
  liveAq?: LiveAqOverride,
): DeterministicReport {
  const basePreset = resolveBaseCity(profile);
  const { city, dataSource, livePm10, liveNo2 } = applyLiveAqOverride(basePreset, liveAq);
  const cpcb =
    dataSource === 'live_open_meteo'
      ? computeCpcbAqi(city.baselinePm25, livePm10, liveNo2)
      : computeCpcbAqi(city.baselinePm25, city.baselinePm10, city.baselineNo2);
  const exposure = computeExposureMetrics(profile, city.baselinePm25);
  const emissions = computeEmissionsMetrics(profile);
  const rankedHacks = rankIAQHacksByBudget(profile);
  const recommendedHacks = rankedHacks.map((hack) => hack.id);
  const citations = buildCitations(city, dataSource, exposure, emissions, liveAq?.sourceLabel);

  return {
    city,
    dataSource,
    cpcbAqi: cpcb.aqi,
    aqiBand: cpcb.band,
    dominantPollutant: cpcb.dominantPollutant,
    ...(livePm10 !== undefined ? { livePm10 } : {}),
    ...(liveNo2 !== undefined ? { liveNo2 } : {}),
    ...resolveOptionalMetadata(liveAq),
    exposure,
    emissions,
    recommendedHacks,
    citations,
  };
}

/**
 * Computes the complete localized daily plan, ranked IAQ hacks, and RWA notice.
 */
export function computeFullPlan(
  profile: UserProfile,
  liveAq?: LiveAqOverride,
): FullPlanOutput {
  const report = computeDeterministicReport(profile, liveAq);
  const iaqHacks = rankIAQHacksByBudget(profile);
  const routine = generateDailyRoutine(profile, report);
  const localizedSummary = formatLocalizedSummary(report, profile.language);
  const rwaNotice = buildRwaNotice(profile, report);

  return {
    report,
    routine,
    iaqHacks,
    localizedSummary,
    rwaNotice,
    citations: report.citations,
  };
}

/**
 * Compares two household choices side-by-side and returns quantitative deltas.
 */
export function compareWhatIf(
  baseline: UserProfile,
  alternative: UserProfile,
  liveAq?: LiveAqOverride,
): WhatIfComparisonResult {
  const baselineReport = computeDeterministicReport(baseline, liveAq);
  const alternativeReport = computeDeterministicReport(alternative, liveAq);
  const baseRaw = computeRawDailyEmissions(baseline);
  const altRaw = computeRawDailyEmissions(alternative);

  const delta: WhatIfDelta = {
    doseReductionUgPerDay: round2(
      baselineReport.exposure.optimizedInhaledUgPerDay -
        alternativeReport.exposure.optimizedInhaledUgPerDay,
    ),
    co2eAvoidedGramsPerDay: round2(baseRaw.co2eGramsPerDay - altRaw.co2eGramsPerDay),
    pm25AvoidedMgPerDay: round2(baseRaw.pm25MgPerDay - altRaw.pm25MgPerDay),
    monthlyNetSavingsInr: round2(
      baseRaw.monthlyOperatingCostInr - altRaw.monthlyOperatingCostInr,
    ),
  };

  const explanation = formatWhatIfExplanation(delta, baselineReport, alternativeReport);
  const citations: Readonly<Record<string, string>> = {
    ...alternativeReport.citations,
    'CALC:DOSE_BEFORE': `${String(baselineReport.exposure.optimizedInhaledUgPerDay)} ug/day baseline choice`,
    'CALC:DOSE_AFTER': `${String(alternativeReport.exposure.optimizedInhaledUgPerDay)} ug/day alternative choice`,
    'CALC:CO2E_SAVED': `${String(delta.co2eAvoidedGramsPerDay)} g CO2e/day delta`,
    'CALC:INR_DELTA': `INR ${String(delta.monthlyNetSavingsInr)}/month delta`,
  };

  return {
    baseline: baselineReport,
    alternative: alternativeReport,
    delta,
    explanation,
    citations,
  };
}
