/**
 * Facade orchestrating deterministic exposure, emissions, citations, and what-if plans.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import { computeCpcbAqi } from './cpcbAqi.js';
import { round2 } from './domainUtils.js';
import {
  computeEmissionsMetrics,
  computeRawDailyEmissions,
  rankIAQHacksByBudget,
  scaleCommunityEmissions,
  selectAffordableHacks,
} from './emissionsEngine.js';
import { computeExposureMetrics, computeSelectedDailyDose } from './exposureEngine.js';
import {
  buildRwaNotice,
  formatLocalizedSummary,
  formatWhatIfExplanation,
} from './i18n.js';
import {
  buildCitations,
  isSameLocationTarget,
  resolveReportAq,
} from './liveAqResolver.js';
import { getAfternoonVentilation } from './ventilation.js';
import { generateDailyRoutine } from './routineBuilder.js';
import type {
  DeterministicReport,
  FullPlanOutput,
  ExposureMetrics,
  IAQHackDetail,
  LiveAqOverride,
  UserProfile,
  WhatIfComparisonResult,
  WhatIfDelta,
} from './types.js';

function recommendHacks(
  profile: UserProfile, exposure: ExposureMetrics, ranked: readonly IAQHackDetail[],
  canVentilate: boolean,
) {
  const outdoor = exposure.hourlySeries?.map((hour) => hour.outdoorPm25) ?? [];
  const applicable = ranked.filter((hack) => hack.id !== 'ventilation_window' || canVentilate);
  return selectAffordableHacks(profile, applicable, (id) => {
    const withHack = { ...profile, activeHacks: [...profile.activeHacks, id] };
    return exposure.optimizedInhaledUgPerDay - computeSelectedDailyDose(withHack, outdoor);
  });
}

function buildUnavailableExposure(): ExposureMetrics {
  return {
    baselineInhaledUgPerDay: 0,
    optimizedInhaledUgPerDay: 0,
    doseReductionUgPerDay: 0,
    doseReductionPercent: 0,
    baselineIndoorPm25: 0,
    optimizedIndoorPm25: 0,
    optimalVentilationWindow: 'Unavailable',
  };
}

/** Reconstructs the authoritative LiveAqOverride from a DeterministicReport when live. */
export function extractReportLiveAq(report: DeterministicReport): LiveAqOverride | undefined {
  if (report.dataSource !== 'live_open_meteo') return undefined;
  const sourceLabel = report.citations['AQ:SOURCE'];
  return {
    pm25: report.city.baselinePm25,
    cpcbAqi: report.cpcbAqi,
    dominantPollutant: report.dominantPollutant,
    ...(report.livePm10 !== undefined ? { pm10: report.livePm10 } : {}),
    ...(report.liveNo2 !== undefined ? { no2: report.liveNo2 } : {}),
    ...(report.observedAt !== undefined ? { observedAt: report.observedAt } : {}),
    ...(sourceLabel !== undefined ? { sourceLabel } : {}),
  };
}

function buildDeterministicReport(
  profile: UserProfile,
  liveAq: LiveAqOverride | undefined,
  ranked: readonly IAQHackDetail[],
): DeterministicReport {
  const { sourceLabel, ...aq } = resolveReportAq(profile, liveAq);
  const { city, dataSource, livePm10, liveNo2 } = aq;
  const cpcb =
    dataSource === 'live_open_meteo'
      ? computeCpcbAqi(city.baselinePm25, livePm10, liveNo2)
      : computeCpcbAqi(city.baselinePm25, city.baselinePm10, city.baselineNo2);
  const exposure = aq.aqStatus === 'unavailable'
    ? buildUnavailableExposure()
    : computeExposureMetrics(profile, city.baselinePm25);
  const emissions = computeEmissionsMetrics(profile);
  const vent = getAfternoonVentilation({ ...aq, exposure });
  const recommendedHacks = aq.aqStatus === 'unavailable'
    ? [] : recommendHacks(profile, exposure, ranked, vent.canVentilate);
  const citations = buildCitations(
    city, dataSource, exposure, emissions, sourceLabel, aq.aqStatus,
  );

  return {
    ...aq,
    cpcbAqi: cpcb.aqi,
    aqiBand: cpcb.band,
    dominantPollutant: cpcb.dominantPollutant,
    exposure,
    emissions,
    recommendedHacks,
    citations,
  };
}

/**
 * Computes the core deterministic Tier 1 exposure, emissions, and citations report.
 */
export function computeDeterministicReport(
  profile: UserProfile,
  liveAq?: LiveAqOverride,
): DeterministicReport {
  return buildDeterministicReport(profile, liveAq, rankIAQHacksByBudget(profile));
}

/** Overlays RWA community savings onto a plan without recomputing exposure or routine. */
export function buildRwaScaledPlan(basePlan: FullPlanOutput, profile: UserProfile): FullPlanOutput {
  const community = scaleCommunityEmissions(profile);
  const report: DeterministicReport = {
    ...basePlan.report,
    emissions: { ...basePlan.report.emissions, ...community },
  };
  return { ...basePlan, report, rwaNotice: buildRwaNotice(profile, report) };
}

/**
 * Computes the complete localized daily plan, ranked IAQ hacks, and RWA notice.
 */
export function computeFullPlan(
  profile: UserProfile,
  liveAq?: LiveAqOverride,
): FullPlanOutput {
  const iaqHacks = rankIAQHacksByBudget(profile);
  const report = buildDeterministicReport(profile, liveAq, iaqHacks);
  const routine = report.aqStatus === 'unavailable' ? [] : generateDailyRoutine(profile, report);
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
  baselineLiveAq?: LiveAqOverride,
  alternativeLiveAq?: LiveAqOverride,
): WhatIfComparisonResult {
  const sharedLiveAq = isSameLocationTarget(baseline, alternative) ? baselineLiveAq : undefined;
  return compareWhatIfFromBaseline(
    baseline, computeDeterministicReport(baseline, baselineLiveAq),
    alternative, alternativeLiveAq ?? sharedLiveAq,
  );
}

/** Compares an alternative using the household report already displayed on screen. */
export function compareWhatIfFromBaseline(
  baseline: UserProfile,
  baselineReport: DeterministicReport,
  alternative: UserProfile,
  alternativeLiveAq?: LiveAqOverride,
): WhatIfComparisonResult {
  const effectiveAltAq = alternativeLiveAq ?? (
    isSameLocationTarget(baseline, alternative)
      ? extractReportLiveAq(baselineReport)
      : undefined
  );
  const alternativeReport = computeDeterministicReport(
    alternative,
    effectiveAltAq,
  );
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
