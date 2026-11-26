import { describe, expect, it } from 'vitest';
import {
  computeEmissionsMetrics,
  computeRawDailyEmissions,
  rankIAQHacksByBudget,
} from '../../src/domain/emissionsEngine.js';
import type { UserProfile } from '../../src/domain/types.js';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    persona: 'young_family',
    cityId: 'delhi',
    language: 'en',
    householdSize: 4,
    hasVulnerableMember: false,
    monthlyBudgetInr: 1200,
    roomVolumeM3: 45,
    commuteMode: 'petrol_car',
    commuteDistanceKm: 20,
    cookingFuel: 'lpg',
    activeHacks: [],
    rwaHouseholds: 90,
    rwaAdoptionRate: 0.5,
    ...overrides,
  };
}

describe('emissionsEngine commute & cooking deltas', () => {
  it('computes positive CO2e and PM2.5 avoidance for petrol_car -> metro_bus', () => {
    const petrol = computeRawDailyEmissions(makeProfile({ commuteMode: 'petrol_car' }));
    const metro = computeRawDailyEmissions(makeProfile({ commuteMode: 'metro_bus' }));
    const metrics = computeEmissionsMetrics(makeProfile({ commuteMode: 'metro_bus' }));

    expect(metro.co2eGramsPerDay).toBeLessThan(petrol.co2eGramsPerDay);
    expect(metro.pm25MgPerDay).toBeLessThan(petrol.pm25MgPerDay);
    expect(metrics.co2eAvoidedGramsPerDay).toBeGreaterThan(0);
    expect(metrics.pm25AvoidedMgPerDay).toBeGreaterThan(0);
    expect(metrics.monthlyNetSavingsInr).toBeGreaterThan(0);
  });

  it('computes lower raw emissions for biomass_chulha -> induction', () => {
    const biomass = computeRawDailyEmissions(
      makeProfile({ cookingFuel: 'biomass_chulha', commuteDistanceKm: 0 }),
    );
    const induction = computeRawDailyEmissions(
      makeProfile({ cookingFuel: 'induction', commuteDistanceKm: 0 }),
    );

    expect(induction.co2eGramsPerDay).toBeLessThan(biomass.co2eGramsPerDay);
    expect(induction.pm25MgPerDay).toBeLessThan(biomass.pm25MgPerDay);
  });

  it('handles zero commute distance cleanly without NaN or negative avoidance', () => {
    const metrics = computeEmissionsMetrics(
      makeProfile({ commuteMode: 'wfh_walk', commuteDistanceKm: 0 }),
    );
    expect(Number.isFinite(metrics.co2eAvoidedGramsPerDay)).toBe(true);
    expect(metrics.co2eAvoidedGramsPerDay).toBeGreaterThanOrEqual(0);
    expect(metrics.pm25AvoidedMgPerDay).toBeGreaterThanOrEqual(0);
  });
});

describe('emissionsEngine budget ranking & RWA scaling', () => {
  it('ranks zero/low-cost hacks first for INR 1200 vs INR 6000 budgets', () => {
    const lowBudget = rankIAQHacksByBudget(makeProfile({ monthlyBudgetInr: 1200 }));
    const highBudget = rankIAQHacksByBudget(makeProfile({ monthlyBudgetInr: 6000 }));

    expect(lowBudget[0]?.withinBudget).toBe(true);
    expect(lowBudget[0]?.monthlyCostInr).toBe(0);

    const lowInBudget = lowBudget.filter((h) => h.withinBudget).length;
    const highInBudget = highBudget.filter((h) => h.withinBudget).length;
    expect(highInBudget).toBeGreaterThanOrEqual(lowInBudget);
  });

  it('scales RWA community impact linearly from 90 to 180 households', () => {
    const rwa90 = computeEmissionsMetrics(
      makeProfile({
        commuteMode: 'metro_bus',
        rwaHouseholds: 90,
        rwaAdoptionRate: 0.5,
      }),
    );
    const rwa180 = computeEmissionsMetrics(
      makeProfile({
        commuteMode: 'metro_bus',
        rwaHouseholds: 180,
        rwaAdoptionRate: 0.5,
      }),
    );

    expect(rwa90.communityCo2eAvoidedKgPerMonth).toBeGreaterThan(0);
    expect(rwa180.communityCo2eAvoidedKgPerMonth).toBeCloseTo(
      rwa90.communityCo2eAvoidedKgPerMonth * 2,
      1,
    );
    expect(rwa180.communityPm25AvoidedGramsPerMonth).toBeCloseTo(
      rwa90.communityPm25AvoidedGramsPerMonth * 2,
      1,
    );
  });

  it('deduplicates duplicate activeHacks so monthly INR cost is counted once per hack', () => {
    const single = computeRawDailyEmissions(makeProfile({ activeHacks: ['hepa_purifier'] }));
    const duped = computeRawDailyEmissions(
      makeProfile({ activeHacks: ['hepa_purifier', 'hepa_purifier', 'hepa_purifier'] }),
    );
    expect(duped.monthlyOperatingCostInr).toBe(single.monthlyOperatingCostInr);
  });
});
