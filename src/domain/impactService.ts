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
} from './emissionsEngine.js';
import { computeExposureMetrics } from './exposureEngine.js';
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
import { generateDailyRoutine } from './routineBuilder.js';
import type {
  DeterministicReport,
  FullPlanOutput,
  IAQHackDetail,
  LiveAqOverride,
  UserProfile,
  WhatIfComparisonResult,
  WhatIfDelta,
} from './types.js';

function buildDeterministicReport(
  profile: UserProfile,
  liveAq: LiveAqOverride | undefined,
  rankedHacks: readonly IAQHackDetail[],
): DeterministicReport {
  const { sourceLabel, ...aq } = resolveReportAq(profile, liveAq);
  const { city, dataSource, livePm10, liveNo2 } = aq;
  const cpcb =
    dataSource === 'live_open_meteo'
      ? computeCpcbAqi(city.baselinePm25, livePm10, liveNo2)
      : computeCpcbAqi(city.baselinePm25, city.baselinePm10, city.baselineNo2);
  const exposure = computeExposureMetrics(profile, city.baselinePm25);
  const emissions = computeEmissionsMetrics(profile);
  const recommendedHacks = rankedHacks.map((hack) => hack.id);
  const citations = buildCitations(city, dataSource, exposure, emissions, sourceLabel);

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

/**
 * Computes the complete localized daily plan, ranked IAQ hacks, and RWA notice.
 */
export function computeFullPlan(
  profile: UserProfile,
  liveAq?: LiveAqOverride,
): FullPlanOutput {
  const iaqHacks = rankIAQHacksByBudget(profile);
  const report = buildDeterministicReport(profile, liveAq, iaqHacks);
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
  baselineLiveAq?: LiveAqOverride,
  alternativeLiveAq?: LiveAqOverride,
): WhatIfComparisonResult {
  const sharedLiveAq = isSameLocationTarget(baseline, alternative) ? baselineLiveAq : undefined;
  const baselineReport = computeDeterministicReport(baseline, baselineLiveAq);
  const alternativeReport = computeDeterministicReport(
    alternative,
    alternativeLiveAq ?? sharedLiveAq,
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
