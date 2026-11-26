import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  sanitizeLocationText,
  StrictCoordSchema,
  stripCitationTags,
} from '../../server/middleware/locationGuard.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { buildRwaNotice, formatLocalizedSummary } from '../../src/domain/i18n.js';
import { SAMPLE_SCENARIOS } from '../../src/domain/sampleScenarios.js';
import {
  computeDeterministicReport,
  computeFullPlan,
} from '../../src/domain/impactService.js';
import type { UserProfile } from '../../src/domain/types.js';

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
      expect(report.citations['CALC:INDOOR_TARGET']).toBeDefined();
      expect(report.citations['SCI:PLANTS_VS_HEPA']).toBeDefined();
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

    const familyMorning = family.routine.find((s) => s.id === 'morning_inversion')?.title;
    const commuterMorning = commuter.routine.find((s) => s.id === 'morning_inversion')?.title;
    const studentMorning = student.routine.find((s) => s.id === 'morning_inversion')?.title;

    expect(commuterMorning).toBeDefined();
    expect(studentMorning).toBeDefined();
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
