/**
 * Deterministic household emissions, monthly INR savings, RWA scaling, and IAQ ranking.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import {
  COMMUTE_EMISSION_FACTORS,
  COOKING_DAILY_FACTORS,
  IAQ_HACK_SPECS,
  MAX_COMMUTE_KM,
  MAX_RWA_HOUSEHOLDS,
} from './constants.js';
import { clampFinite, clampHouseholds, round2 } from './domainUtils.js';
import type {
  CommuteMode,
  CookingFuel,
  EmissionsMetrics,
  IAQHackDetail,
  IAQHackId,
  UserProfile,
} from './types.js';

const COMMUTE_DAYS_PER_MONTH = 22;
const DAYS_PER_MONTH = 30;
const ALL_HACK_IDS: readonly IAQHackId[] = [
  'ventilation_window',
  'wet_mopping',
  'window_sealing',
  'n95_mask',
  'corsi_rosenthal_box',
  'hepa_purifier',
];

/** Raw daily household emissions for direct scenario-to-scenario comparisons. */
export interface RawDailyEmissions {
  readonly co2eGramsPerDay: number;
  readonly pm25MgPerDay: number;
  readonly monthlyOperatingCostInr: number;
}

function clampDistanceKm(distanceKm: number): number {
  return clampFinite(distanceKm, 0, MAX_COMMUTE_KM, 0);
}

function clampAdoptionRate(rate: number | undefined): number {
  return rate === undefined ? 0 : clampFinite(rate, 0, 1, 0);
}

function resolveCommuteFactor(mode: CommuteMode) {
  return Object.hasOwn(COMMUTE_EMISSION_FACTORS, mode)
    ? COMMUTE_EMISSION_FACTORS[mode]
    : COMMUTE_EMISSION_FACTORS.petrol_car;
}

function resolveCookingFactor(fuel: CookingFuel) {
  return Object.hasOwn(COOKING_DAILY_FACTORS, fuel)
    ? COOKING_DAILY_FACTORS[fuel]
    : COOKING_DAILY_FACTORS.lpg;
}

function sumActiveHacksCostInr(activeHacks: readonly IAQHackId[]): number {
  let total = 0;
  for (const id of new Set(activeHacks)) {
    if (Object.hasOwn(IAQ_HACK_SPECS, id)) {
      total += IAQ_HACK_SPECS[id].monthlyCostInr;
    }
  }
  return total;
}

/**
 * Computes raw daily CO2e (g), PM2.5 (mg), and monthly operating cost (INR).
 */
export function computeRawDailyEmissions(profile: UserProfile): RawDailyEmissions {
  const km = clampDistanceKm(profile.commuteDistanceKm);
  const commute = resolveCommuteFactor(profile.commuteMode);
  const cooking = resolveCookingFactor(profile.cookingFuel);
  const hacksCost = sumActiveHacksCostInr(profile.activeHacks);

  const co2eGramsPerDay = round2(km * commute.co2eGramsPerKm + cooking.co2eGramsPerDay);
  const pm25MgPerDay = round2(km * commute.pm25MgPerKm + cooking.pm25MgPerDay);
  const monthlyOperatingCostInr = round2(
    km * commute.costInrPerKm * COMMUTE_DAYS_PER_MONTH + cooking.monthlyCostInr + hacksCost,
  );

  return { co2eGramsPerDay, pm25MgPerDay, monthlyOperatingCostInr };
}

/**
 * Computes household emissions avoided vs. petrol car & LPG baseline, plus RWA scaling.
 */
export function computeEmissionsMetrics(profile: UserProfile): EmissionsMetrics {
  const km = clampDistanceKm(profile.commuteDistanceKm);
  const baseCommute = COMMUTE_EMISSION_FACTORS.petrol_car;
  const userCommute = resolveCommuteFactor(profile.commuteMode);
  const baseCooking = COOKING_DAILY_FACTORS.lpg;
  const userCooking = resolveCookingFactor(profile.cookingFuel);

  const commuteCo2Saved = Math.max(
    0,
    (baseCommute.co2eGramsPerKm - userCommute.co2eGramsPerKm) * km,
  );
  const cookCo2Saved = Math.max(0, baseCooking.co2eGramsPerDay - userCooking.co2eGramsPerDay);
  const co2eAvoidedGramsPerDay = round2(commuteCo2Saved + cookCo2Saved);

  const commutePmSaved = Math.max(0, (baseCommute.pm25MgPerKm - userCommute.pm25MgPerKm) * km);
  const cookPmSaved = Math.max(0, baseCooking.pm25MgPerDay - userCooking.pm25MgPerDay);
  const pm25AvoidedMgPerDay = round2(commutePmSaved + cookPmSaved);

  const commuteCostSaved =
    (baseCommute.costInrPerKm - userCommute.costInrPerKm) * km * COMMUTE_DAYS_PER_MONTH;
  const cookCostSaved = baseCooking.monthlyCostInr - userCooking.monthlyCostInr;
  const hacksCost = sumActiveHacksCostInr(profile.activeHacks);
  const monthlyNetSavingsInr = round2(commuteCostSaved + cookCostSaved - hacksCost);

  const activeHomes =
    clampHouseholds(profile.rwaHouseholds, MAX_RWA_HOUSEHOLDS) *
    clampAdoptionRate(profile.rwaAdoptionRate);
  const communityCo2eAvoidedKgPerMonth = round2(
    ((co2eAvoidedGramsPerDay * DAYS_PER_MONTH) / 1000) * activeHomes,
  );
  const communityPm25AvoidedGramsPerMonth = round2(
    ((pm25AvoidedMgPerDay * DAYS_PER_MONTH) / 1000) * activeHomes,
  );

  return {
    co2eAvoidedGramsPerDay,
    pm25AvoidedMgPerDay,
    monthlyNetSavingsInr,
    communityCo2eAvoidedKgPerMonth,
    communityPm25AvoidedGramsPerMonth,
  };
}

/**
 * Ranks IAQ interventions in O(N) by monthly budget so within-budget low-cost hacks appear first.
 */
export function rankIAQHacksByBudget(profile: UserProfile): readonly IAQHackDetail[] {
  const budget = clampFinite(profile.monthlyBudgetInr, 0, Number.MAX_SAFE_INTEGER, 0);
  const activeSet = new Set<IAQHackId>(profile.activeHacks);
  const withinBudget: IAQHackDetail[] = [];
  const overBudget: IAQHackDetail[] = [];

  for (const id of ALL_HACK_IDS) {
    const spec = IAQ_HACK_SPECS[id];
    const affordable = spec.monthlyCostInr <= budget;
    const detail: IAQHackDetail = {
      id: spec.id,
      name: spec.name,
      nameHi: spec.nameHi,
      instructions: spec.instructions,
      instructionsHi: spec.instructionsHi,
      monthlyCostInr: spec.monthlyCostInr,
      doseImpactLabel: spec.doseImpactLabel,
      doseImpactLabelHi: spec.doseImpactLabelHi,
      withinBudget: affordable,
      isActive: activeSet.has(id),
    };
    if (affordable) {
      withinBudget.push(detail);
    } else {
      overBudget.push(detail);
    }
  }

  return [...withinBudget, ...overBudget];
}
