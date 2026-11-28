/**
 * Diurnal inversion curve & transient single-zone indoor PM2.5 mass-balance physics.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import {
  ACH_BASELINE,
  ACH_SEALED,
  ACH_VENTILATION,
  CADR_CORSI_ROSENTHAL_M3H,
  CADR_HEPA_PURIFIER_M3H,
  COOKING_EMISSION_UG_PER_HOUR,
  COOKING_HOURS,
  DEFAULT_ROOM_VOLUME_M3,
  DEPOSITION_BASELINE,
  DEPOSITION_WET_MOPPING,
  DIURNAL_INVERSION_FACTORS,
  MAX_AMBIENT_PM25,
  MAX_ROOM_VOLUME_M3,
  MIN_ROOM_VOLUME_M3,
  OPTIMAL_VENTILATION_HOURS,
  PENETRATION_SEALED,
  PENETRATION_UNSEALED,
} from './constants.js';
import { clampFinite, round2 } from './domainUtils.js';
import type { CookingFuel, IAQHackId, UserProfile } from './types.js';
import { canVentilateAfternoon } from './ventilation.js';

const COOKING_HOUR_SET: ReadonlySet<number> = new Set(COOKING_HOURS);
const COOKING_EXHAUST_HOURS = new Set(COOKING_HOURS.flatMap((hour) => [hour, hour + 1, hour + 2]));
const VENTILATION_HOUR_SET: ReadonlySet<number> = new Set(OPTIMAL_VENTILATION_HOURS);

interface SeriesOptions {
  readonly cookRate: number;
  readonly volume: number;
  readonly deposition: number;
  readonly cadr: number;
  readonly sealed: boolean;
  readonly ventilated: boolean;
}

function clampPm25(pm25: number): number {
  return clampFinite(pm25, 0, MAX_AMBIENT_PM25, 0);
}

function clampRoomVolume(volumeM3: number): number {
  return clampFinite(volumeM3, MIN_ROOM_VOLUME_M3, MAX_ROOM_VOLUME_M3, DEFAULT_ROOM_VOLUME_M3);
}

function resolveCookingRate(fuel: CookingFuel): number {
  return Object.hasOwn(COOKING_EMISSION_UG_PER_HOUR, fuel)
    ? COOKING_EMISSION_UG_PER_HOUR[fuel]
    : COOKING_EMISSION_UG_PER_HOUR.lpg;
}

function computeEffectiveCadr(hackSet: ReadonlySet<IAQHackId>, useOptimized: boolean): number {
  if (!useOptimized) {
    return 0;
  }
  const cr = hackSet.has('corsi_rosenthal_box') ? CADR_CORSI_ROSENTHAL_M3H : 0;
  const hepa = hackSet.has('hepa_purifier') ? CADR_HEPA_PURIFIER_M3H : 0;
  return cr + hepa;
}

function buildSeriesOptions(profile: UserProfile, useOptimized: boolean): SeriesOptions {
  const hackSet = new Set<IAQHackId>(profile.activeHacks);
  const wetMop = useOptimized && hackSet.has('wet_mopping');
  return {
    cookRate: resolveCookingRate(profile.cookingFuel),
    volume: clampRoomVolume(profile.roomVolumeM3),
    deposition: wetMop ? DEPOSITION_WET_MOPPING : DEPOSITION_BASELINE,
    cadr: computeEffectiveCadr(hackSet, useOptimized),
    sealed: useOptimized && hackSet.has('window_sealing'),
    ventilated: useOptimized && hackSet.has('ventilation_window'),
  };
}

function areSteadyInputsValid(params: readonly number[]): boolean {
  return params.every((val) => Number.isFinite(val));
}

/** Computes steady-state single-zone indoor PM2.5 concentration (ug/m^3). */
export function computeSteadyStateIndoor(
  penetration: number,
  ach: number,
  cOut: number,
  eCook: number,
  volume: number,
  deposition: number,
  cadr: number,
): number {
  const safeOut = clampPm25(cOut);
  if (
    volume <= 0 ||
    !areSteadyInputsValid([penetration, ach, eCook, volume, deposition, cadr])
  ) {
    return safeOut;
  }
  const safePen = Math.max(0, penetration);
  const safeAch = Math.max(0, ach);
  const safeCook = Math.max(0, eCook);
  const safeDep = Math.max(0, deposition);
  const safeCadr = Math.max(0, cadr);
  const numerator = safePen * safeAch * safeOut + safeCook / volume;
  const denominator = safeAch + safeDep + safeCadr / volume;
  return denominator > 0 ? Math.max(0, numerator / denominator) : safeOut;
}

function stepTransientIndoor(
  prevIndoor: number,
  penetration: number,
  ach: number,
  cOut: number,
  eCook: number,
  volume: number,
  deposition: number,
  cadr: number,
  hours = 1,
): number {
  const steady = computeSteadyStateIndoor(
    penetration,
    ach,
    cOut,
    eCook,
    volume,
    deposition,
    cadr,
  );
  const decayRate = Math.max(0, ach) + Math.max(0, deposition) + Math.max(0, cadr) / volume;
  const transient = steady + (prevIndoor - steady) * Math.exp(-decayRate * hours);
  return Number.isFinite(transient) ? Math.max(0, transient) : steady;
}

function computeHourConcentration(
  prevIndoor: number,
  cOut: number,
  hour: number,
  opts: SeriesOptions,
  eligibleHours: Set<number> | undefined,
): number {
  const eCook = COOKING_HOUR_SET.has(hour) ? opts.cookRate : 0;
  // Maintain kitchen exhaust during cooking and the modeled recovery period.
  const sealed = opts.sealed && !COOKING_EXHAUST_HOURS.has(hour);
  const penetration = sealed ? PENETRATION_SEALED : PENETRATION_UNSEALED;
  const ach = sealed ? ACH_SEALED : ACH_BASELINE;
  const closed = (start: number, hours: number) => stepTransientIndoor(
    start, penetration, ach, cOut, eCook, opts.volume, opts.deposition, opts.cadr, hours,
  );
  const closedEnd = closed(prevIndoor, 1);
  if (!VENTILATION_HOUR_SET.has(hour)
    || !canVentilateAfternoon(cOut, Math.min(prevIndoor, closedEnd))) return closedEnd;
  eligibleHours?.add(hour);
  if (!opts.ventilated) return closedEnd;

  const opened = stepTransientIndoor(
    prevIndoor, 1, ACH_VENTILATION, cOut, eCook, opts.volume, opts.deposition, opts.cadr, 0.5,
  );
  return Math.min(closedEnd, closed(opened, 0.5));
}

/** Computes the 24-hour winter boundary-layer diurnal outdoor PM2.5 curve (ug/m^3). */
export function computeHourlyInversionCurve(baselinePm25: number): readonly number[] {
  const safeBase = clampPm25(baselinePm25);
  return DIURNAL_INVERSION_FACTORS.map((factor) => round2(safeBase * factor));
}

/** Models indoor PM2.5 and optionally collects hours when opening windows can reduce it. */
export function simulateIndoorSeries(
  outdoorSeries: readonly number[],
  profile: UserProfile,
  useOptimized: boolean,
  eligibleHours?: Set<number>,
): readonly number[] {
  if (outdoorSeries.length === 0) {
    return [];
  }
  const opts = buildSeriesOptions(profile, useOptimized);
  const lastOut = clampPm25(outdoorSeries[outdoorSeries.length - 1] ?? 0);
  let prev = computeSteadyStateIndoor(
    opts.sealed ? PENETRATION_SEALED : PENETRATION_UNSEALED,
    opts.sealed ? ACH_SEALED : ACH_BASELINE,
    lastOut,
    0,
    opts.volume,
    opts.deposition,
    opts.cadr,
  );
  const series = new Array<number>(outdoorSeries.length);
  for (let hour = 0; hour < outdoorSeries.length; hour += 1) {
    prev = computeHourConcentration(
      prev, clampPm25(Number(outdoorSeries[hour])), hour % 24, opts, undefined,
    );
  }
  for (let hour = 0; hour < outdoorSeries.length; hour += 1) {
    prev = computeHourConcentration(
      prev, clampPm25(Number(outdoorSeries[hour])), hour % 24, opts, eligibleHours,
    );
    series[hour] = round2(prev);
  }
  return series;
}

/** Computes the 24-hour transient single-zone indoor PM2.5 mass-balance series (ug/m^3). */
export function computeIndoorSeries(
  outdoorSeries: readonly number[],
  profile: UserProfile,
  useOptimized: boolean,
): readonly number[] {
  return simulateIndoorSeries(outdoorSeries, profile, useOptimized);
}
