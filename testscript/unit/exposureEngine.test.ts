import { describe, expect, it } from 'vitest';
import { clampFinite, isPlainRecord, round2, round4 } from '../../src/domain/domainUtils.js';
import {
  computeExposureMetrics,
  computeHourlyInversionCurve,
  computeIndoorSeries,
  computeSteadyStateIndoor,
} from '../../src/domain/exposureEngine.js';
import type { IAQHackId, UserProfile } from '../../src/domain/types.js';

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    persona: 'young_family',
    cityId: 'delhi',
    language: 'en',
    householdSize: 4,
    hasVulnerableMember: false,
    monthlyBudgetInr: 3000,
    roomVolumeM3: 45,
    commuteMode: 'petrol_car',
    commuteDistanceKm: 20,
    cookingFuel: 'lpg',
    activeHacks: [],
    ...overrides,
  };
}

describe('exposureEngine diurnal curve & mass balance', () => {
  it('models winter diurnal inversion peaks higher than midday trough', () => {
    const curve = computeHourlyInversionCurve(200);
    expect(curve).toHaveLength(24);
    const morningPeak = curve[7] ?? 0;
    const middayTrough = curve[14] ?? 0;
    const eveningPeak = curve[21] ?? 0;
    expect(morningPeak).toBeGreaterThan(middayTrough);
    expect(eveningPeak).toBeGreaterThan(middayTrough);
  });

  it('computes indoor mass-balance C_in(h) below outdoor peak without cooking', () => {
    const curve = computeHourlyInversionCurve(250);
    const profile = makeProfile({ activeHacks: ['window_sealing', 'hepa_purifier'] });
    const baseIn = computeIndoorSeries(curve, profile, false);
    const optIn = computeIndoorSeries(curve, profile, true);
    expect(optIn).toHaveLength(24);
    expect(optIn[2] ?? 999).toBeLessThan(baseIn[2] ?? 0);
    expect(optIn[2] ?? 999).toBeLessThan(curve[2] ?? 0);
  });

  it('clamps roomVolumeM3 to [12, 500] bounds safely', () => {
    const curve = computeHourlyInversionCurve(200);
    const tiny = computeIndoorSeries(curve, makeProfile({ roomVolumeM3: 2 }), true);
    const minBound = computeIndoorSeries(curve, makeProfile({ roomVolumeM3: 12 }), true);
    const huge = computeIndoorSeries(curve, makeProfile({ roomVolumeM3: 2000 }), true);
    const maxBound = computeIndoorSeries(curve, makeProfile({ roomVolumeM3: 500 }), true);
    expect(tiny).toEqual(minBound);
    expect(huge).toEqual(maxBound);
  });
});

describe('exposureEngine intervention deltas & edge cases', () => {
  it('reduces daily inhaled dose for each IAQ and mask intervention', () => {
    const hacks: readonly IAQHackId[] = [
      'window_sealing',
      'wet_mopping',
      'corsi_rosenthal_box',
      'hepa_purifier',
      'n95_mask',
    ];
    for (const hack of hacks) {
      const metrics = computeExposureMetrics(makeProfile({ activeHacks: [hack] }), 260);
      expect(metrics.baselineInhaledUgPerDay).toBeGreaterThan(
        metrics.optimizedInhaledUgPerDay,
      );
      expect(metrics.doseReductionUgPerDay).toBeGreaterThan(0);
    }

    const sealedOnly = computeExposureMetrics(makeProfile({ activeHacks: ['window_sealing'] }), 260);
    const sealedPlusVent = computeExposureMetrics(
      makeProfile({ activeHacks: ['window_sealing', 'ventilation_window'] }),
      260,
    );
    expect(sealedPlusVent).toEqual(sealedOnly);
    expect(sealedPlusVent.hourlySeries?.some((point) => point.isOptimalVentilation)).toBe(false);
  });

  it('reduces dose with ventilation when cleaner outdoor air can flush residual cooking PM2.5', () => {
    const profile = makeProfile({ cookingFuel: 'biomass_chulha', roomVolumeM3: 12 });
    for (const activeHacks of [[], ['window_sealing']] satisfies readonly IAQHackId[][]) {
      const closed = computeExposureMetrics({ ...profile, activeHacks }, 0);
      const open = computeExposureMetrics({
        ...profile,
        activeHacks: [...activeHacks, 'ventilation_window'],
      }, 0);
      expect(open.hourlySeries?.[13]?.isOptimalVentilation).toBe(true);
      expect(open.optimizedIndoorPm25).toBeLessThan(closed.optimizedIndoorPm25);
      expect(open.optimizedInhaledUgPerDay).toBeLessThan(closed.optimizedInhaledUgPerDay);
    }
  });

  it('keeps windows closed at mild outdoor levels when sealing and HEPA make indoor air cleaner', () => {
    const profile = makeProfile({ activeHacks: ['window_sealing', 'hepa_purifier'] });
    const closed = computeExposureMetrics(profile, 75);
    const withVent = computeExposureMetrics({
      ...profile,
      activeHacks: [...profile.activeHacks, 'ventilation_window'],
    }, 75);
    expect(withVent.hourlySeries?.[14]?.isOptimalVentilation).toBe(false);
    expect(withVent).toEqual(closed);
  });

  it('scales inhaled dose upward when a vulnerable member is present', () => {
    const standard = computeExposureMetrics(makeProfile({ hasVulnerableMember: false }), 220);
    const vulnerable = computeExposureMetrics(makeProfile({ hasVulnerableMember: true }), 220);
    expect(vulnerable.baselineInhaledUgPerDay).toBeGreaterThan(
      standard.baselineInhaledUgPerDay,
    );
  });

  it('handles extreme PM2.5 = 999 cleanly with finite positive metrics', () => {
    const profile = makeProfile({
      activeHacks: ['window_sealing', 'wet_mopping', 'hepa_purifier', 'n95_mask'],
    });
    const metrics = computeExposureMetrics(profile, 999);
    expect(Number.isFinite(metrics.baselineInhaledUgPerDay)).toBe(true);
    expect(Number.isFinite(metrics.optimizedInhaledUgPerDay)).toBe(true);
    expect(metrics.doseReductionPercent).toBeGreaterThan(40);
    expect(metrics.optimalVentilationWindow).toBe('13:00 - 16:00');
  });

  it('preserves monotonic IAQ invariance at mild outdoor PM2.5 = 37.4 ug/m3', () => {
    const cases: readonly UserProfile[] = [
      makeProfile({
        cookingFuel: 'induction',
        activeHacks: ['ventilation_window', 'n95_mask'],
      }),
      makeProfile({
        cookingFuel: 'biomass_chulha',
        activeHacks: ['window_sealing'],
      }),
    ];
    for (const profile of cases) {
      const metrics = computeExposureMetrics(profile, 37.4);
      expect(Number.isFinite(metrics.optimizedIndoorPm25)).toBe(true);
      expect(Number.isFinite(metrics.optimizedInhaledUgPerDay)).toBe(true);
      expect(metrics.optimizedIndoorPm25).toBeGreaterThanOrEqual(0);
      expect(metrics.optimizedInhaledUgPerDay).toBeGreaterThanOrEqual(0);
      expect(metrics.optimizedIndoorPm25).toBeLessThanOrEqual(metrics.baselineIndoorPm25);
      expect(metrics.optimizedInhaledUgPerDay).toBeLessThanOrEqual(
        metrics.baselineInhaledUgPerDay,
      );
    }
  });

  it('guards NaN, Infinity, zero volume, zero denominator, and empty series safely', () => {
    expect(computeIndoorSeries([], makeProfile(), true)).toEqual([]);
    expect(computeSteadyStateIndoor(0.6, 0.8, 120, 500, 0, 0.2, 100)).toBe(120);
    expect(computeSteadyStateIndoor(Number.NaN, 0.8, 120, 500, 45, 0.2, 100)).toBe(120);
    expect(computeSteadyStateIndoor(0.6, 0, 120, 500, 45, 0, 0)).toBe(120);

    const nanMetrics = computeExposureMetrics(makeProfile(), Number.NaN);
    expect(nanMetrics.baselineIndoorPm25).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(nanMetrics.baselineInhaledUgPerDay)).toBe(true);
    const infMetrics = computeExposureMetrics(makeProfile(), Number.POSITIVE_INFINITY);
    expect(infMetrics.baselineInhaledUgPerDay).toBe(nanMetrics.baselineInhaledUgPerDay);

    expect(clampFinite(Number.NaN, 1, 10, 5)).toBe(5);
    expect(clampFinite(-5, 1, 10, 5)).toBe(1);
    expect(clampFinite(25, 1, 10, 5)).toBe(10);
    expect(round2(1.005 + Number.EPSILON)).toBe(1.01);
    expect(round2(Number.NaN)).toBe(0);
    expect(round4(28.123456)).toBe(28.1235);
    expect(round4(Number.POSITIVE_INFINITY)).toBe(0);
    expect(isPlainRecord({ ok: true })).toBe(true);
    expect(isPlainRecord([1, 2])).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
  });
});
