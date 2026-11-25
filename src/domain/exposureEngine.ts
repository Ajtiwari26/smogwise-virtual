/**
 * Deterministic diurnal inversion, indoor mass-balance, and inhaled dose engine.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import {
  ACH_BASELINE,
  ACH_SEALED,
  ACH_VENTILATION,
  CADR_CORSI_ROSENTHAL_M3H,
  CADR_HEPA_PURIFIER_M3H,
  COMMUTE_HOURS,
  COOKING_EMISSION_UG_PER_HOUR,
  COOKING_HOURS,
  DEPOSITION_BASELINE,
  DEPOSITION_WET_MOPPING,
  DIURNAL_INVERSION_FACTORS,
  INHALATION_COMMUTE_M3H,
  INHALATION_RESTING_M3H,
  INHALATION_SLEEP_M3H,
  MAX_ROOM_VOLUME_M3,
  MIN_ROOM_VOLUME_M3,
  N95_FILTRATION_EFFICIENCY,
  OPTIMAL_VENTILATION_HOURS,
  PENETRATION_SEALED,
  PENETRATION_UNSEALED,
  VULNERABLE_INHALATION_MULTIPLIER,
} from './constants.js';
import type { ExposureMetrics, HourlyExposurePoint, IAQHackId, UserProfile } from './types.js';

const MAX_AMBIENT_PM25 = 1500;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampRoomVolume(volumeM3: number): number {
  if (!Number.isFinite(volumeM3)) {
    return 45;
  }
  return Math.min(MAX_ROOM_VOLUME_M3, Math.max(MIN_ROOM_VOLUME_M3, volumeM3));
}

function clampPm25(pm25: number): number {
  if (!Number.isFinite(pm25)) {
    return 0;
  }
  return Math.min(MAX_AMBIENT_PM25, Math.max(0, pm25));
}

function formatHourLabel(hour: number): string {
  const padded = String(hour).padStart(2, '0');
  return `${padded}:00`;
}

function hasHack(hacks: readonly IAQHackId[], id: IAQHackId): boolean {
  return hacks.includes(id);
}

function computeEffectiveCadr(hacks: readonly IAQHackId[], useOptimized: boolean): number {
  if (!useOptimized) {
    return 0;
  }
  const cr = hasHack(hacks, 'corsi_rosenthal_box') ? CADR_CORSI_ROSENTHAL_M3H : 0;
  const hepa = hasHack(hacks, 'hepa_purifier') ? CADR_HEPA_PURIFIER_M3H : 0;
  return cr + hepa;
}

function computeHourlyAch(
  hour: number,
  hacks: readonly IAQHackId[],
  useOptimized: boolean,
): number {
  if (!useOptimized) {
    return ACH_BASELINE;
  }
  if (hasHack(hacks, 'ventilation_window') && OPTIMAL_VENTILATION_HOURS.includes(hour)) {
    return ACH_VENTILATION;
  }
  return hasHack(hacks, 'window_sealing') ? ACH_SEALED : ACH_BASELINE;
}

function computeHourlyInhalationRate(
  hour: number,
  isCommute: boolean,
  hasVulnerableMember: boolean,
): number {
  const baseRate = isCommute
    ? INHALATION_COMMUTE_M3H
    : hour >= 22 || hour <= 5
      ? INHALATION_SLEEP_M3H
      : INHALATION_RESTING_M3H;
  return hasVulnerableMember ? baseRate * VULNERABLE_INHALATION_MULTIPLIER : baseRate;
}

/**
 * Computes the 24-hour winter boundary-layer diurnal outdoor PM2.5 curve (ug/m^3).
 */
export function computeHourlyInversionCurve(baselinePm25: number): readonly number[] {
  const safeBase = clampPm25(baselinePm25);
  return DIURNAL_INVERSION_FACTORS.map((factor) => round2(safeBase * factor));
}

/**
 * Computes the 24-hour single-zone indoor PM2.5 mass-balance series (ug/m^3).
 */
export function computeIndoorSeries(
  outdoorSeries: readonly number[],
  profile: UserProfile,
  useOptimized: boolean,
): readonly number[] {
  const volume = clampRoomVolume(profile.roomVolumeM3);
  const hacks = profile.activeHacks;
  const penetration =
    useOptimized && hasHack(hacks, 'window_sealing') ? PENETRATION_SEALED : PENETRATION_UNSEALED;
  const deposition =
    useOptimized && hasHack(hacks, 'wet_mopping') ? DEPOSITION_WET_MOPPING : DEPOSITION_BASELINE;
  const cadr = computeEffectiveCadr(hacks, useOptimized);
  const cookRate = COOKING_EMISSION_UG_PER_HOUR[profile.cookingFuel];

  return outdoorSeries.map((cOut, hour) => {
    const ach = computeHourlyAch(hour, hacks, useOptimized);
    const eCook = COOKING_HOURS.includes(hour) ? cookRate : 0;
    const numerator = penetration * ach * cOut + eCook / volume;
    const denominator = ach + deposition + cadr / volume;
    return round2(denominator > 0 ? numerator / denominator : cOut);
  });
}

function buildHourlyPoints(
  profile: UserProfile,
  outdoorSeries: readonly number[],
  baselineIndoor: readonly number[],
  optimizedIndoor: readonly number[],
): readonly HourlyExposurePoint[] {
  const commutesOutdoors = profile.commuteMode !== 'wfh_walk' && profile.commuteDistanceKm > 0;
  const maskFactor = hasHack(profile.activeHacks, 'n95_mask')
    ? 1 - N95_FILTRATION_EFFICIENCY
    : 1;

  return outdoorSeries.map((cOut, hour) => {
    const baseIn = baselineIndoor[hour] ?? cOut;
    const optIn = optimizedIndoor[hour] ?? cOut;
    const isCommute = commutesOutdoors && COMMUTE_HOURS.includes(hour);
    const ir = computeHourlyInhalationRate(hour, isCommute, profile.hasVulnerableMember);
    const baseDose = round2((isCommute ? cOut : baseIn) * ir);
    const optDose = round2((isCommute ? cOut * maskFactor : optIn) * ir);
    return {
      hour,
      label: formatHourLabel(hour),
      outdoorPm25: cOut,
      baselineIndoorPm25: baseIn,
      optimizedIndoorPm25: optIn,
      baselineDoseUg: baseDose,
      optimizedDoseUg: optDose,
      isOptimalVentilation: OPTIMAL_VENTILATION_HOURS.includes(hour),
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
  const baselineIndoor = computeIndoorSeries(outdoorSeries, profile, false);
  const optimizedIndoor = computeIndoorSeries(outdoorSeries, profile, true);
  const hourlySeries = buildHourlyPoints(profile, outdoorSeries, baselineIndoor, optimizedIndoor);

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
