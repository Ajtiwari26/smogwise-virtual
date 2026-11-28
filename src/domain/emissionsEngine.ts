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

/** Totals unique selected interventions at their catalog monthly prices. */
export function sumActiveHacksCostInr(activeHacks: readonly IAQHackId[]): number {
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

/** Scales commuting over 22 days and cooking over 30 days per month. */
export function scaleCommunityEmissions(
  profile: UserProfile,
): Pick<EmissionsMetrics, 'communityCo2eAvoidedKgPerMonth' | 'communityPm25AvoidedGramsPerMonth'> {
  const activeHomes =
    clampHouseholds(profile.rwaHouseholds, MAX_RWA_HOUSEHOLDS)
    * clampAdoptionRate(profile.rwaAdoptionRate);
  const commute = resolveCommuteFactor(profile.commuteMode);
  const cooking = resolveCookingFactor(profile.cookingFuel);
  const commuteKm = clampDistanceKm(profile.commuteDistanceKm) * COMMUTE_DAYS_PER_MONTH;
  const car = COMMUTE_EMISSION_FACTORS.petrol_car;
  const lpg = COOKING_DAILY_FACTORS.lpg;
  const co2e = (car.co2eGramsPerKm - commute.co2eGramsPerKm) * commuteKm
    + (lpg.co2eGramsPerDay - cooking.co2eGramsPerDay) * DAYS_PER_MONTH;
  const pm25 = (car.pm25MgPerKm - commute.pm25MgPerKm) * commuteKm
    + (lpg.pm25MgPerDay - cooking.pm25MgPerDay) * DAYS_PER_MONTH;
  return {
    communityCo2eAvoidedKgPerMonth: round2(co2e * activeHomes / 1000),
    communityPm25AvoidedGramsPerMonth: round2(pm25 * activeHomes / 1000),
  };
}

/**
 * Computes household emissions net delta vs. petrol car & LPG baseline, plus RWA scaling.
 * Negative avoided values indicate net emissions increases relative to baseline.
 */
export function computeEmissionsMetrics(profile: UserProfile): EmissionsMetrics {
  const baselineProfile: UserProfile = {
    ...profile,
    commuteMode: 'petrol_car',
    cookingFuel: 'lpg',
    activeHacks: [],
  };
  const baseRaw = computeRawDailyEmissions(baselineProfile);
  const userRaw = computeRawDailyEmissions(profile);

  const co2eAvoidedGramsPerDay = round2(baseRaw.co2eGramsPerDay - userRaw.co2eGramsPerDay);
  const pm25AvoidedMgPerDay = round2(baseRaw.pm25MgPerDay - userRaw.pm25MgPerDay);
  const monthlyNetSavingsInr = round2(
    baseRaw.monthlyOperatingCostInr - userRaw.monthlyOperatingCostInr,
  );

  return {
    co2eAvoidedGramsPerDay,
    pm25AvoidedMgPerDay,
    monthlyNetSavingsInr,
    ...scaleCommunityEmissions(profile),
  };
}

/**
 * Ranks IAQ interventions in O(N) by monthly budget so within-budget low-cost hacks appear first.
 */
export function rankIAQHacksByBudget(profile: UserProfile): readonly IAQHackDetail[] {
  const budget = clampFinite(profile.monthlyBudgetInr, 0, Number.MAX_SAFE_INTEGER, 0);
  const activeSet = new Set<IAQHackId>(profile.activeHacks);
  const activeSpend = sumActiveHacksCostInr(profile.activeHacks);
  const withinBudget: IAQHackDetail[] = [];
  const overBudget: IAQHackDetail[] = [];

  for (const id of ALL_HACK_IDS) {
    const spec = IAQ_HACK_SPECS[id];
    const selected = activeSet.has(id);
    const total = activeSpend + (selected ? 0 : spec.monthlyCostInr);
    const affordable = spec.monthlyCostInr === 0 || total <= budget;
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
      isActive: selected,
    };
    if (affordable) {
      withinBudget.push(detail);
    } else {
      overBudget.push(detail);
    }
  }

  return [...withinBudget, ...overBudget];
}

/** Recommends jointly affordable interventions in order of modeled benefit within each tier. */
export function selectAffordableHacks(
  profile: UserProfile,
  ranked: readonly IAQHackDetail[],
  assess: (id: IAQHackId) => number,
): readonly IAQHackId[] {
  const affordable = ranked.filter((hack) => hack.withinBudget);
  const existing = affordable.filter((hack) => hack.isActive).map((hack) => hack.id);
  const candidates = affordable
    .filter((hack) => !hack.isActive)
    .map((hack) => ({ hack, benefit: assess(hack.id) }))
    .filter(({ benefit }) => benefit > 0)
    .sort((a, b) => freeFirst(a.hack, b.hack) || b.benefit - a.benefit);
  const selectedSpend = sumActiveHacksCostInr(profile.activeHacks);
  let remaining = Math.max(0, profile.monthlyBudgetInr - selectedSpend);
  for (const { hack } of candidates) {
    if (hack.monthlyCostInr > remaining) continue;
    remaining -= hack.monthlyCostInr;
    existing.push(hack.id);
  }
  return existing;
}

function freeFirst(a: IAQHackDetail, b: IAQHackDetail): number {
  return Number(b.monthlyCostInr === 0) - Number(a.monthlyCostInr === 0);
}
