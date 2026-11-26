/**
 * Deterministic household emissions, monthly INR savings, RWA scaling, and IAQ ranking.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import {
  COMMUTE_EMISSION_FACTORS,
  COOKING_DAILY_FACTORS,
  IAQ_HACK_SPECS,
} from './constants.js';
import type { EmissionsMetrics, IAQHackDetail, IAQHackId, UserProfile } from './types.js';

const COMMUTE_DAYS_PER_MONTH = 22;
const DAYS_PER_MONTH = 30;
const MAX_COMMUTE_KM = 300;
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampDistanceKm(distanceKm: number): number {
  if (!Number.isFinite(distanceKm)) {
    return 0;
  }
  return Math.min(MAX_COMMUTE_KM, Math.max(0, distanceKm));
}

function clampAdoptionRate(rate: number | undefined): number {
  if (rate === undefined || !Number.isFinite(rate)) {
    return 0;
  }
  return Math.min(1, Math.max(0, rate));
}

function clampHouseholds(count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count)) {
    return 0;
  }
  return Math.max(0, Math.round(count));
}

function sumActiveHacksCostInr(activeHacks: readonly IAQHackId[]): number {
  let total = 0;
  for (const id of new Set(activeHacks)) {
    total += IAQ_HACK_SPECS[id].monthlyCostInr;
  }
  return total;
}

/**
 * Computes raw daily CO2e (g), PM2.5 (mg), and monthly operating cost (INR).
 */
export function computeRawDailyEmissions(profile: UserProfile): RawDailyEmissions {
  const km = clampDistanceKm(profile.commuteDistanceKm);
  const commute = COMMUTE_EMISSION_FACTORS[profile.commuteMode];
  const cooking = COOKING_DAILY_FACTORS[profile.cookingFuel];
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
  const userCommute = COMMUTE_EMISSION_FACTORS[profile.commuteMode];
  const baseCooking = COOKING_DAILY_FACTORS.lpg;
  const userCooking = COOKING_DAILY_FACTORS[profile.cookingFuel];

  const co2DiffPerKm = baseCommute.co2eGramsPerKm - userCommute.co2eGramsPerKm;
  const commuteCo2Saved = Math.max(0, co2DiffPerKm * km);
  const cookCo2Saved = Math.max(0, baseCooking.co2eGramsPerDay - userCooking.co2eGramsPerDay);
  const co2eAvoidedGramsPerDay = round2(commuteCo2Saved + cookCo2Saved);

  const pmDiffPerKm = baseCommute.pm25MgPerKm - userCommute.pm25MgPerKm;
  const commutePmSaved = Math.max(0, pmDiffPerKm * km);
  const cookPmSaved = Math.max(0, baseCooking.pm25MgPerDay - userCooking.pm25MgPerDay);
  const pm25AvoidedMgPerDay = round2(commutePmSaved + cookPmSaved);

  const costDiffPerKm = baseCommute.costInrPerKm - userCommute.costInrPerKm;
  const commuteCostSaved = costDiffPerKm * km * COMMUTE_DAYS_PER_MONTH;
  const cookCostSaved = baseCooking.monthlyCostInr - userCooking.monthlyCostInr;
  const hacksCost = sumActiveHacksCostInr(profile.activeHacks);
  const monthlyNetSavingsInr = round2(commuteCostSaved + cookCostSaved - hacksCost);

  const households = clampHouseholds(profile.rwaHouseholds);
  const adoption = clampAdoptionRate(profile.rwaAdoptionRate);
  const activeHomes = households * adoption;

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
 * Ranks IAQ interventions by monthly budget so zero/low-cost hacks always appear first.
 */
export function rankIAQHacksByBudget(profile: UserProfile): readonly IAQHackDetail[] {
  const budget = Number.isFinite(profile.monthlyBudgetInr)
    ? Math.max(0, profile.monthlyBudgetInr)
    : 0;

  const items: IAQHackDetail[] = ALL_HACK_IDS.map((id) => {
    const spec = IAQ_HACK_SPECS[id];
    return {
      id: spec.id,
      name: spec.name,
      nameHi: spec.nameHi,
      instructions: spec.instructions,
      instructionsHi: spec.instructionsHi,
      monthlyCostInr: spec.monthlyCostInr,
      doseImpactLabel: spec.doseImpactLabel,
      doseImpactLabelHi: spec.doseImpactLabelHi,
      withinBudget: spec.monthlyCostInr <= budget,
      isActive: profile.activeHacks.includes(id),
    };
  });

  return items.sort((a, b) => {
    if (a.withinBudget !== b.withinBudget) {
      return a.withinBudget ? -1 : 1;
    }
    return a.monthlyCostInr - b.monthlyCostInr;
  });
}
