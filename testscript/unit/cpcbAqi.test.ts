import { describe, expect, it } from 'vitest';
import {
  escapeXml,
  sanitizeLocationText,
  StrictCoordSchema,
  stripCitationTags,
} from '../../server/middleware/locationGuard.js';
import { computeCpcbAqi } from '../../src/domain/cpcbAqi.js';
import { SAMPLE_SCENARIOS } from '../../src/domain/sampleScenarios.js';
import { computeFullPlan } from '../../src/domain/impactService.js';

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
  it('includes 4 presets each yielding CALC:INDOOR_TARGET and SCI:PLANTS_VS_HEPA', () => {
    expect(SAMPLE_SCENARIOS).toHaveLength(4);
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
