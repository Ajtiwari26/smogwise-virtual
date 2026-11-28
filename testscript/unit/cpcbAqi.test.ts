import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  sanitizeLocationText,
  StrictCoordSchema,
  stripCitationTags,
} from '../../server/middleware/locationGuard.js';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { buildRwaNotice, formatLocalizedSummary } from '../../src/domain/i18n.js';
import { SAMPLE_SCENARIOS } from '../../src/domain/sampleScenarios.js';
import {
  compareWhatIf,
  computeDeterministicReport,
  computeFullPlan,
} from '../../src/domain/impactService.js';
import {
  applyLiveAqOverride,
  buildCitations,
  deriveGrapStageFromPm25,
  isSameLocationTarget,
  resolveBaseCity,
} from '../../src/domain/liveAqResolver.js';
import { generateDailyRoutine } from '../../src/domain/routineBuilder.js';
import type { DeterministicReport, UserProfile } from '../../src/domain/types.js';

describe('computeCpcbAqi deterministic CPCB NAQI calculator', () => {
  it('maps concentrations across all 6 CPCB NAQI bands accurately', () => {
    expect(computeCpcbAqi(15)).toEqual({ aqi: 25, band: 'good', dominantPollutant: 'PM2.5' });
    expect(computeCpcbAqi(45)).toEqual({
      aqi: 76,
      band: 'satisfactory',
      dominantPollutant: 'PM2.5',
    });
    expect(computeCpcbAqi(75)).toEqual({
      aqi: 151,
      band: 'moderate',
      dominantPollutant: 'PM2.5',
    });
    expect(computeCpcbAqi(105)).toEqual({ aqi: 251, band: 'poor', dominantPollutant: 'PM2.5' });
    expect(computeCpcbAqi(185)).toEqual({
      aqi: 351,
      band: 'very_poor',
      dominantPollutant: 'PM2.5',
    });
    expect(computeCpcbAqi(375)).toEqual({ aqi: 451, band: 'severe', dominantPollutant: 'PM2.5' });
  });

  it('enforces exact breakpoint boundaries and caps extreme concentrations at 500', () => {
    const atThirty = computeCpcbAqi(30);
    expect(atThirty.aqi).toBe(50);
    expect(atThirty.band).toBe('good');

    const justAboveThirty = computeCpcbAqi(30.1);
    expect(justAboveThirty.aqi).toBeGreaterThanOrEqual(51);
    expect(justAboveThirty.band).toBe('satisfactory');

    const extreme = computeCpcbAqi(999, 1200, 900);
    expect(extreme.aqi).toBe(500);
    expect(extreme.band).toBe('severe');
  });

  it('switches dominantPollutant among PM2.5, PM10, and NO2 by highest sub-index', () => {
    expect(computeCpcbAqi(40, 40, 20).dominantPollutant).toBe('PM2.5');
    expect(computeCpcbAqi(25, 220, 30)).toEqual({
      aqi: 180,
      band: 'moderate',
      dominantPollutant: 'PM10',
    });
    expect(computeCpcbAqi(20, 40, 230)).toEqual({
      aqi: 251,
      band: 'poor',
      dominantPollutant: 'NO2',
    });
  });

  it('ignores NaN, Infinity, or negative secondary pm10/no2 inputs safely', () => {
    const baseline = computeCpcbAqi(60);
    expect(computeCpcbAqi(60, Number.NaN, -45)).toEqual(baseline);
    expect(computeCpcbAqi(60, -10, Number.POSITIVE_INFINITY)).toEqual(baseline);
  });
});

describe('SAMPLE_SCENARIOS deterministic plan integration', () => {
  it('includes 6 presets covering all 5 personas and yielding CALC:INDOOR_TARGET and SCI:PLANTS_VS_HEPA', () => {
    expect(SAMPLE_SCENARIOS).toHaveLength(6);
    const personas = new Set(SAMPLE_SCENARIOS.map((s) => s.profile.persona));
    expect(personas).toEqual(
      new Set([
        'young_family',
        'sensitive_household',
        'rwa_coordinator',
        'office_commuter',
        'outdoor_student',
      ]),
    );
    for (const scenario of SAMPLE_SCENARIOS) {
      const report = computeFullPlan(scenario.profile);
      expect(report.citations['CALC:INDOOR_TARGET']).toContain('ug/m3');
      expect(report.citations['SCI:PLANTS_VS_HEPA']).toContain('HEPA/CR-box');
      expect(report.routine.length).toBeGreaterThan(0);
    }
  });
});

describe('locationGuard sanitization and coordinate validation', () => {
  it('strips structured citation tags while preserving plain bracketed notes', () => {
    const raw = 'Indore [CALC:DOSE_BEFORE] [SCI:PLANTS_VS_HEPA] [AQ:LIVE] (MP)';
    expect(stripCitationTags(raw).replace(/\s+/g, ' ').trim()).toBe('Indore (MP)');
  });

  it('escapes all five XML special characters safely', () => {
    expect(escapeXml('<city name="Indore" tag=\'MP\'>A & B</city>')).toBe(
      '&lt;city name=&quot;Indore&quot; tag=&apos;MP&apos;&gt;A &amp; B&lt;/city&gt;',
    );
  });

  it('applies NFKC normalization and strips unsafe brackets/delimiters', () => {
    const dirty = '  Ｊａｉｐｕｒ [POLICY:ADMIN] <script>{alert}</script>  ';
    expect(sanitizeLocationText(dirty)).toBe('Jaipur script alert script');
  });

  it('validates strict decimal coordinates and rejects non-numeric strings', () => {
    expect(StrictCoordSchema.safeParse('22.7196').success).toBe(true);
    expect(StrictCoordSchema.safeParse('-77.09').success).toBe(true);
    expect(StrictCoordSchema.safeParse('22.7196abc').success).toBe(false);
    expect(StrictCoordSchema.safeParse('NaN').success).toBe(false);
  });
});

const BASE_PROFILE: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: false,
  monthlyBudgetInr: 4000,
  roomVolumeM3: 90,
  commuteMode: 'two_wheeler',
  commuteDistanceKm: 20,
  cookingFuel: 'lpg',
  activeHacks: [],
};

describe('persona differentiation, PM10 summary, RWA notice, and PM2.5-only live AQ', () => {
  it('differentiates commute personas in delhi_anand_vihar', () => {
    const family = computeFullPlan({ ...BASE_PROFILE, persona: 'young_family' });
    const commuter = computeFullPlan({ ...BASE_PROFILE, persona: 'office_commuter' });
    const student = computeFullPlan({ ...BASE_PROFILE, persona: 'outdoor_student' });

    const familyDose = family.report.exposure.baselineInhaledUgPerDay;
    expect(commuter.report.exposure.baselineInhaledUgPerDay).toBeGreaterThan(familyDose);
    expect(student.report.exposure.baselineInhaledUgPerDay).toBeGreaterThan(familyDose);

    const familyMorning = family.routine.find((s) => s.id === 'morning_inversion')?.title ?? '';
    const commuterMorning = commuter.routine.find((s) => s.id === 'morning_inversion')?.title ?? '';
    const studentMorning = student.routine.find((s) => s.id === 'morning_inversion')?.title ?? '';

    expect(commuterMorning).toContain('Rush-Hour');
    expect(studentMorning).toContain('Campus');
    expect(commuterMorning).not.toBe(familyMorning);
    expect(studentMorning).not.toBe(familyMorning);
  });

  it('formats localized summary using PM10-driven Poor CPCB band in en and hi', () => {
    const report = computeDeterministicReport(BASE_PROFILE, { pm25: 40, pm10: 280 });
    expect(report.aqiBand).toBe('poor');

    const enSummary = formatLocalizedSummary(report, 'en');
    const hiSummary = formatLocalizedSummary(report, 'hi');

    expect(enSummary).toContain('Poor');
    expect(enSummary).not.toContain('Satisfactory');
    expect(hiSummary).toContain('खराब');
    expect(hiSummary).not.toContain('Satisfactory');
  });

  it('renders unconfigured RWA notice when rwaHouseholds is 0 or undefined', () => {
    const enProfile: UserProfile = { ...BASE_PROFILE, language: 'en', rwaHouseholds: 0 };
    const hiProfile: UserProfile = { ...BASE_PROFILE, language: 'hi' };
    const enReport = computeDeterministicReport(enProfile);
    const hiReport = computeDeterministicReport(hiProfile);

    const enNotice = buildRwaNotice(enProfile, enReport);
    const hiNotice = buildRwaNotice(hiProfile, hiReport);

    expect(enNotice).not.toContain('50 flats');
    expect(enNotice).not.toContain('avoids 0 kg');
    expect(enNotice).toContain('Configure participating flats');
    expect(hiNotice).toContain('RWA कम्युनिटी पैनल');
  });

  it('computes PM2.5-only live report without falling back to Delhi PM10', () => {
    const report = computeDeterministicReport(BASE_PROFILE, { pm25: 55 });
    expect(report.dataSource).toBe('live_open_meteo');
    expect(report.livePm10).toBeUndefined();
    expect(report.liveNo2).toBeUndefined();
    expect(report.cpcbAqi).toBe(computeCpcbAqi(55).aqi);
  });
});

describe('outdoor_student sports AQI threshold and commuting multiplier', () => {
  it('switches outdoor_student afternoon sports advice on PM2.5 > 120 and applies 1.1x commute multiplier', () => {
    const commutingStudent = computeFullPlan({
      ...BASE_PROFILE,
      persona: 'outdoor_student',
      commuteMode: 'two_wheeler',
    });
    const wfhStudent = computeFullPlan({
      ...BASE_PROFILE,
      persona: 'outdoor_student',
      commuteMode: 'wfh_walk',
    });
    expect(commutingStudent.report.exposure.baselineInhaledUgPerDay).toBeGreaterThan(
      wfhStudent.report.exposure.baselineInhaledUgPerDay,
    );

    const lowEn = computeFullPlan(
      { ...BASE_PROFILE, persona: 'outdoor_student', language: 'en' },
      { pm25: 100 },
    );
    const highEn = computeFullPlan(
      { ...BASE_PROFILE, persona: 'outdoor_student', language: 'en' },
      { pm25: 250 },
    );
    const highHi = computeFullPlan(
      { ...BASE_PROFILE, persona: 'outdoor_student', language: 'hi' },
      { pm25: 250 },
    );

    expect(lowEn.routine.find((s) => s.id === 'afternoon_ventilation')?.description).toContain(
      'keep afternoon outdoor sports brief',
    );
    expect(highEn.routine.find((s) => s.id === 'afternoon_ventilation')?.description).toContain(
      'shift sports indoors',
    );
    expect(highHi.routine.find((s) => s.id === 'afternoon_ventilation')?.description).toContain(
      'इनडोर खेल चुनें',
    );
  });
});

describe('liveAqResolver, customLocation state, RWA 0-savings notice, and what-if deltas', () => {
  it('resolves customLocation state safely and maps nearest preset without Delhi pollutant leak', () => {
    const customCity = resolveBaseCity({
      ...BASE_PROFILE,
      cityId: 'delhi_anand_vihar',
      customLocation: { name: 'Bandra', state: 'Maharashtra <script>', lat: 19.06, lon: 72.83 },
    });
    expect(customCity.name).toBe('Bandra, Maharashtra');
    expect(customCity.state).toBe('Maharashtra');
    expect(customCity.id).toBe('custom_bandra');
    expect(customCity.baselinePm10).toBe(195);

    const fallbackPreset = applyLiveAqOverride(customCity, {
      pm25: 140,
      fallbackStationName: 'Mumbai Bandra',
      fallbackDistanceKm: 1.5,
    });
    expect(fallbackPreset.dataSource).toBe('city_preset');
    expect(fallbackPreset.city.baselinePm10).toBe(customCity.baselinePm10);

    const liveOverride = applyLiveAqOverride(customCity, { pm25: 260, no2: 44 });
    expect(liveOverride.dataSource).toBe('live_open_meteo');
    expect(liveOverride.city.baselinePm10).toBe(0);
    expect(liveOverride.city.baselineNo2).toBe(44);
    expect(liveOverride.city.grapStage).toBe('GRAP_IV');
    expect(deriveGrapStageFromPm25(80)).toBe('NONE');
    expect(deriveGrapStageFromPm25(120)).toBe('GRAP_I');
    expect(deriveGrapStageFromPm25(180)).toBe('GRAP_II');
    expect(deriveGrapStageFromPm25(220)).toBe('GRAP_III');
    expect(applyLiveAqOverride(customCity, { pm25: Number.NaN }).dataSource).toBe('city_preset');
  });

  it('builds honest RWA notice when configured flats have petrol_car + lpg (0 kg saved) vs positive', () => {
    const zeroSaveProfile: UserProfile = {
      ...BASE_PROFILE,
      commuteMode: 'petrol_car',
      cookingFuel: 'lpg',
      rwaHouseholds: 100,
      rwaAdoptionRate: 0.5,
    };
    const zeroReport = computeDeterministicReport(zeroSaveProfile);
    expect(buildRwaNotice(zeroSaveProfile, zeroReport)).toContain('0 kg CO2e avoided');
    expect(buildRwaNotice({ ...zeroSaveProfile, language: 'hi' }, zeroReport)).toContain(
      '0 kg CO2e',
    );

    const positiveProfile: UserProfile = { ...zeroSaveProfile, commuteMode: 'metro_bus' };
    const positiveReport = computeDeterministicReport(positiveProfile);
    expect(buildRwaNotice(positiveProfile, positiveReport)).toContain('50% adoption across 100 flats');
    expect(buildRwaNotice({ ...positiveProfile, language: 'hi' }, positiveReport)).toContain(
      '100 फ्लैट्स में 50%',
    );
  });

  it('uses live AQ only for the location that supplied it in a what-if comparison', () => {
    const baseline = { ...BASE_PROFILE, cityId: 'delhi' };
    const alternative = { ...BASE_PROFILE, cityId: 'mumbai_bandra' };
    const baselineLive = { pm25: 312, sourceLabel: 'Delhi live' };
    const expectedAlternative = computeDeterministicReport(alternative);

    const comparison = compareWhatIf(baseline, alternative, baselineLive, undefined);
    expect(comparison.baseline.citations['AQ:SOURCE']).toBe('Delhi live');
    expect(comparison.alternative).toEqual(expectedAlternative);
    expect(comparison.citations['AQ:SOURCE']).toBe(expectedAlternative.citations['AQ:SOURCE']);
    expect(compareWhatIf(baseline, alternative, baselineLive).alternative).toEqual(
      expectedAlternative,
    );

    const alias = { ...baseline, cityId: 'delhi_anand_vihar' };
    expect(compareWhatIf(baseline, alias, baselineLive).alternative.city.baselinePm25).toBe(312);
    expect(compareWhatIf(baseline, alternative, baselineLive, { pm25: 42 }).alternative.city
      .baselinePm25).toBe(42);
  });

  it.each([
    { outdoor: 140, indoor: 180, canVentilate: false },
    { outdoor: 50, indoor: 30, canVentilate: false },
    { outdoor: 29, indoor: 30, canVentilate: true },
  ])('compares outdoor $outdoor and indoor $indoor at the afternoon window', (
    { outdoor, indoor, canVentilate },
  ) => {
    const report = computeDeterministicReport(BASE_PROFILE);
    const { hourlySeries, ...exposure } = report.exposure;
    expect(hourlySeries).toBeDefined();
    const routine = generateDailyRoutine(BASE_PROFILE, {
      ...report,
      city: { ...report.city, baselinePm25: outdoor },
      exposure: { ...exposure, optimizedIndoorPm25: indoor },
    });
    expect(routine.find((item) => item.id === 'afternoon_ventilation')?.description).toContain(
      canVentilate ? 'Cross-ventilate' : 'Keep windows closed',
    );
  });

  it.each([30, 30.01])('uses the inclusive indoor PM2.5 target at %s ug/m3', (indoorPm25) => {
    const report = computeDeterministicReport(BASE_PROFILE);
    const { hourlySeries, ...baseExposure } = report.exposure;
    expect(hourlySeries).toBeDefined();
    const exposure = { ...baseExposure, optimizedIndoorPm25: indoorPm25 };
    const citations = buildCitations(report.city, report.dataSource, exposure, report.emissions);
    const night = generateDailyRoutine(BASE_PROFILE, { ...report, exposure })
      .find((item) => item.id === 'night_recovery');
    const expected = indoorPm25 === 30 ? '<= 30 ug/m3' : '0.01 ug/m3 above';
    expect(citations['CALC:INDOOR_TARGET']).toContain(expected);
    expect(night?.description).toContain(expected);
  });

  it('formats negative emissions deltas honestly in compareWhatIf', () => {
    const cleanBase: UserProfile = {
      ...BASE_PROFILE,
      commuteMode: 'metro_bus',
      cookingFuel: 'induction',
    };
    const dirtyAlt: UserProfile = {
      ...BASE_PROFILE,
      commuteMode: 'petrol_car',
      cookingFuel: 'biomass_chulha',
    };
    const cmp = compareWhatIf(cleanBase, dirtyAlt);
    expect(cmp.delta.co2eAvoidedGramsPerDay).toBeLessThan(0);
    expect(cmp.explanation.en).toContain('shifts daily emissions by 6480');
    expect(cmp.explanation.hi).toContain('बदलाव होता है');
  });

  it('covers routineBuilder missing series fallback, indoor > outdoor cooking spike, practical indoor target, and HI sports', () => {
    const lowStudentHi = computeFullPlan(
      { ...BASE_PROFILE, persona: 'outdoor_student', language: 'hi' },
      { pm25: 90 },
    );
    expect(lowStudentHi.routine.find((s) => s.id === 'afternoon_ventilation')?.description).toContain(
      'हल्का बाहरी खेल संक्षिप्त रखें',
    );

    const cleanIndoorProfile: UserProfile = {
      ...BASE_PROFILE,
      cityId: 'bengaluru_silk_board',
      cookingFuel: 'induction',
      activeHacks: ['window_sealing', 'hepa_purifier', 'corsi_rosenthal_box'],
    };
    const cleanEnReport = computeDeterministicReport(cleanIndoorProfile, { pm25: 20 });
    expect(cleanEnReport.exposure.optimizedIndoorPm25).toBeLessThanOrEqual(30);
    const cleanEnRoutine = generateDailyRoutine(cleanIndoorProfile, cleanEnReport);
    expect(cleanEnRoutine.find((s) => s.id === 'night_recovery')?.description).toContain(
      'meets the <= 30 ug/m3 target',
    );
    const cleanHiRoutine = generateDailyRoutine(
      { ...cleanIndoorProfile, language: 'hi' },
      cleanEnReport,
    );
    expect(cleanHiRoutine.find((s) => s.id === 'night_recovery')?.description).toContain(
      'व्यावहारिक लक्ष्य (<= 30 ug/m3) पर है',
    );

    const { hourlySeries: omittedSeries, ...baseExposure } = cleanEnReport.exposure;
    expect(omittedSeries).toBeDefined();
    const noSeriesReport = {
      ...cleanEnReport,
      city: { ...cleanEnReport.city, baselinePm25: 15 },
      exposure: { ...baseExposure, optimizedIndoorPm25: 42 },
    };
    const spikeEn = generateDailyRoutine(BASE_PROFILE, noSeriesReport);
    const spikeHi = generateDailyRoutine({ ...BASE_PROFILE, language: 'hi' }, noSeriesReport);
    expect(spikeEn.find((s) => s.id === 'evening_cooking')?.description).toContain(
      'kitchen exhaust',
    );
    expect(spikeHi.find((s) => s.id === 'evening_cooking')?.description).toContain(
      'रसोई एग्जॉस्ट',
    );

    const unknownPersona: UserProfile = JSON.parse(
      JSON.stringify({ ...BASE_PROFILE, persona: 'unknown_persona' }),
    );
    expect(generateDailyRoutine(unknownPersona, cleanEnReport)).toHaveLength(4);
  });

  it('guards Object.prototype keys in resolveCityPreset, cookingFuel, and aqiBand lookups', () => {
    expect(resolveCityPreset('constructor').id).toBe('delhi_anand_vihar');
    expect(resolveCityPreset('toString').id).toBe('delhi_anand_vihar');

    const protoFuelProfile: UserProfile = JSON.parse(
      JSON.stringify({ ...BASE_PROFILE, cookingFuel: 'toString' }),
    );
    const protoPlan = computeFullPlan(protoFuelProfile);
    expect(Number.isFinite(protoPlan.report.exposure.optimizedIndoorPm25)).toBe(true);
    expect(protoPlan.report.exposure.optimizedIndoorPm25).toBeGreaterThan(0);

    const protoBandReport: DeterministicReport = JSON.parse(
      JSON.stringify({ ...protoPlan.report, aqiBand: 'constructor' }),
    );
    expect(formatLocalizedSummary(protoBandReport, 'en')).toContain('ambient air is Good');
  });

  it('compares customLocation coordinates in isSameLocationTarget and handles omitted state', () => {
    const customA: UserProfile = {
      ...BASE_PROFILE,
      customLocation: { name: 'Bhopal', lat: 23.26, lon: 77.41 },
    };
    const customB: UserProfile = {
      ...BASE_PROFILE,
      customLocation: { name: 'Udaipur', state: 'Rajasthan', lat: 24.58, lon: 73.71 },
    };
    expect(isSameLocationTarget(customA, customA)).toBe(true);
    expect(isSameLocationTarget(customA, customB)).toBe(false);
    expect(isSameLocationTarget(customA, BASE_PROFILE)).toBe(false);
    expect(resolveBaseCity(customA).state.length).toBeGreaterThan(0);
  });

  it('produces zero delta when comparing an identical live profile against its own report', async () => {
    const { compareWhatIfFromBaseline } = await import('../../src/domain/impactService.js');
    const liveReport = computeDeterministicReport(BASE_PROFILE, {
      pm25: 250, pm10: 340, no2: 65, observedAt: '2026-11-28T08:00',
    });
    const identical = compareWhatIfFromBaseline(BASE_PROFILE, liveReport, BASE_PROFILE);
    expect(identical.delta).toEqual({
      doseReductionUgPerDay: 0,
      co2eAvoidedGramsPerDay: 0,
      pm25AvoidedMgPerDay: 0,
      monthlyNetSavingsInr: 0,
    });
  });
});
