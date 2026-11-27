/**
 * Deterministic diurnal inversion, indoor mass-balance, and inhaled dose engine.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import {
  COMMUTE_HOURS,
  INHALATION_COMMUTE_M3H,
  INHALATION_RESTING_M3H,
  INHALATION_SLEEP_M3H,
  N95_FILTRATION_EFFICIENCY,
  VULNERABLE_INHALATION_MULTIPLIER,
} from './constants.js';
import { round2 } from './domainUtils.js';
import {
  computeHourlyInversionCurve,
  simulateIndoorSeries,
} from './exposureMassBalance.js';
import type {
  ExposureMetrics,
  HourlyExposurePoint,
  IAQHackId,
  UserProfile,
} from './types.js';

/** Re-exported diurnal winter inversion curve solver. */
export { computeHourlyInversionCurve } from './exposureMassBalance.js';
/** Re-exported 24-hour transient indoor PM2.5 mass-balance solver. */
export { computeIndoorSeries } from './exposureMassBalance.js';
/** Re-exported steady-state single-zone indoor PM2.5 mass-balance equation. */
export { computeSteadyStateIndoor } from './exposureMassBalance.js';

const COMMUTE_HOUR_SET: ReadonlySet<number> = new Set(COMMUTE_HOURS);
const OFFICE_COMMUTE_HOUR_SET: ReadonlySet<number> = new Set([8, 9, 18, 19]);
const STUDENT_OUTDOOR_HOUR_SET: ReadonlySet<number> = new Set([7, 8, 15, 16]);

function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function isPersonaOutdoorHour(profile: UserProfile, hour: number): boolean {
  if (profile.persona === 'outdoor_student') {
    return STUDENT_OUTDOOR_HOUR_SET.has(hour);
  }
  const commutesOutdoors = profile.commuteMode !== 'wfh_walk' && profile.commuteDistanceKm > 0;
  if (!commutesOutdoors) {
    return false;
  }
  if (profile.persona === 'office_commuter') {
    return OFFICE_COMMUTE_HOUR_SET.has(hour);
  }
  return COMMUTE_HOUR_SET.has(hour);
}

function computePersonaInhalationRate(
  profile: UserProfile,
  hour: number,
  isOutdoor: boolean,
): number {
  const activityRate = isOutdoor
    ? INHALATION_COMMUTE_M3H
    : hour >= 22 || hour <= 5
      ? INHALATION_SLEEP_M3H
      : INHALATION_RESTING_M3H;
  const sensitiveRate = profile.hasVulnerableMember
    ? activityRate * VULNERABLE_INHALATION_MULTIPLIER
    : activityRate;
  const isCommutingStudent =
    profile.persona === 'outdoor_student' &&
    isOutdoor &&
    profile.commuteMode !== 'wfh_walk' &&
    profile.commuteDistanceKm > 0;
  return isCommutingStudent ? sensitiveRate * 1.1 : sensitiveRate;
}

function buildHourlyPoints(
  profile: UserProfile,
  outdoorSeries: readonly number[],
  baselineIndoor: readonly number[],
  optimizedIndoor: readonly number[],
  eligibleHours: ReadonlySet<number>,
): readonly HourlyExposurePoint[] {
  const hackSet = new Set<IAQHackId>(profile.activeHacks);
  const maskFactor = hackSet.has('n95_mask') ? 1 - N95_FILTRATION_EFFICIENCY : 1;

  return outdoorSeries.map((cOut, hour) => {
    const baseIn = baselineIndoor[hour] ?? cOut;
    const optIn = optimizedIndoor[hour] ?? cOut;
    const isOutdoor = isPersonaOutdoorHour(profile, hour);
    const ir = computePersonaInhalationRate(profile, hour, isOutdoor);
    return {
      hour,
      label: formatHourLabel(hour),
      outdoorPm25: cOut,
      baselineIndoorPm25: baseIn,
      optimizedIndoorPm25: optIn,
      baselineDoseUg: round2((isOutdoor ? cOut : baseIn) * ir),
      optimizedDoseUg: round2((isOutdoor ? cOut * maskFactor : optIn) * ir),
      isOptimalVentilation: eligibleHours.has(hour),
    };
  });
}

/**
 * Computes daily baseline vs. optimized inhaled PM2.5 dose and indoor averages.
 */
export function computeExposureMetrics(
  profile: UserProfile,
  baselinePm25: number,
): ExposureMetrics {
  const outdoorSeries = computeHourlyInversionCurve(baselinePm25);
  const eligibleHours = new Set<number>();
  const baselineIndoor = simulateIndoorSeries(outdoorSeries, profile, false);
  const optimizedIndoor = simulateIndoorSeries(outdoorSeries, profile, true, eligibleHours);
  const hourlySeries = buildHourlyPoints(
    profile, outdoorSeries, baselineIndoor, optimizedIndoor, eligibleHours,
  );

  const baselineDose = round2(hourlySeries.reduce((sum, pt) => sum + pt.baselineDoseUg, 0));
  const optimizedDose = round2(hourlySeries.reduce((sum, pt) => sum + pt.optimizedDoseUg, 0));
  const doseReduction = round2(Math.max(0, baselineDose - optimizedDose));
  const doseReductionPct = baselineDose > 0 ? round2((doseReduction / baselineDose) * 100) : 0;

  const avgBaseIndoor = round2(
    baselineIndoor.reduce((sum, val) => sum + val, 0) / Math.max(1, baselineIndoor.length),
  );
  const avgOptIndoor = round2(
    optimizedIndoor.reduce((sum, val) => sum + val, 0) / Math.max(1, optimizedIndoor.length),
  );

  return {
    baselineInhaledUgPerDay: baselineDose,
    optimizedInhaledUgPerDay: optimizedDose,
    doseReductionUgPerDay: doseReduction,
    doseReductionPercent: doseReductionPct,
    baselineIndoorPm25: avgBaseIndoor,
    optimizedIndoorPm25: avgOptIndoor,
    optimalVentilationWindow: '13:00 - 16:00',
    hourlySeries,
  };
}
