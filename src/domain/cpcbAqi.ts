/**
 * Deterministic CPCB National Air Quality Index (NAQI) piecewise calculator.
 * Pure TypeScript with zero React, DOM, Node, or network dependencies.
 */

import type { AqiBandId, DominantPollutant } from './types.js';

/** Single CPCB NAQI breakpoint interval for a pollutant. */
interface BreakpointBand {
  readonly bpLo: number;
  readonly bpHi: number;
  readonly iLo: number;
  readonly iHi: number;
}

/** Calculated CPCB NAQI output with dominant pollutant attribution. */
export interface CpcbAqiResult {
  readonly aqi: number;
  readonly band: AqiBandId;
  readonly dominantPollutant: DominantPollutant;
}

const PM25_BANDS: readonly BreakpointBand[] = [
  { bpLo: 0, bpHi: 30, iLo: 0, iHi: 50 },
  { bpLo: 30, bpHi: 60, iLo: 51, iHi: 100 },
  { bpLo: 60, bpHi: 90, iLo: 101, iHi: 200 },
  { bpLo: 90, bpHi: 120, iLo: 201, iHi: 300 },
  { bpLo: 120, bpHi: 250, iLo: 301, iHi: 400 },
  { bpLo: 250, bpHi: 500, iLo: 401, iHi: 500 },
];

const PM10_BANDS: readonly BreakpointBand[] = [
  { bpLo: 0, bpHi: 50, iLo: 0, iHi: 50 },
  { bpLo: 50, bpHi: 100, iLo: 51, iHi: 100 },
  { bpLo: 100, bpHi: 250, iLo: 101, iHi: 200 },
  { bpLo: 250, bpHi: 350, iLo: 201, iHi: 300 },
  { bpLo: 350, bpHi: 430, iLo: 301, iHi: 400 },
  { bpLo: 430, bpHi: 600, iLo: 401, iHi: 500 },
];

const NO2_BANDS: readonly BreakpointBand[] = [
  { bpLo: 0, bpHi: 40, iLo: 0, iHi: 50 },
  { bpLo: 40, bpHi: 80, iLo: 51, iHi: 100 },
  { bpLo: 80, bpHi: 180, iLo: 101, iHi: 200 },
  { bpLo: 180, bpHi: 280, iLo: 201, iHi: 300 },
  { bpLo: 280, bpHi: 400, iLo: 301, iHi: 400 },
  { bpLo: 400, bpHi: 600, iLo: 401, iHi: 500 },
];

function isValidConcentration(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function computeSubIndex(concentration: number, bands: readonly BreakpointBand[]): number {
  const clamped = Math.max(0, concentration);
  const lastBand = bands[bands.length - 1] as BreakpointBand;
  const band = bands.find((item) => clamped <= item.bpHi) ?? lastBand;
  if (clamped >= band.bpHi) {
    return band.iHi;
  }
  if (clamped <= band.bpLo) {
    return band.iLo;
  }
  const span = band.bpHi - band.bpLo;
  const raw = band.iLo + ((clamped - band.bpLo) / span) * (band.iHi - band.iLo);
  return Math.max(band.iLo, Math.min(band.iHi, Math.round(raw)));
}

/**
 * Maps a numeric CPCB AQI value (0-500) to its CPCB category band identifier.
 */
export function mapCpcbAqiToBand(aqi: number): AqiBandId {
  const safeAqi = Number.isFinite(aqi) ? Math.max(0, Math.min(500, Math.round(aqi))) : 0;
  if (safeAqi <= 50) {
    return 'good';
  }
  if (safeAqi <= 100) {
    return 'satisfactory';
  }
  if (safeAqi <= 200) {
    return 'moderate';
  }
  if (safeAqi <= 300) {
    return 'poor';
  }
  if (safeAqi <= 400) {
    return 'very_poor';
  }
  return 'severe';
}

/**
 * Computes the deterministic CPCB NAQI sub-indices across PM2.5, PM10, and NO2.
 * Requires a finite non-negative PM2.5 concentration; ignores invalid PM10/NO2 values.
 */
export function computeCpcbAqi(
  pm25: number,
  pm10?: number,
  no2?: number,
): CpcbAqiResult {
  if (!isValidConcentration(pm25)) {
    throw new RangeError('pm25 must be a finite non-negative number');
  }

  let maxAqi = computeSubIndex(pm25, PM25_BANDS);
  let dominantPollutant: DominantPollutant = 'PM2.5';

  if (isValidConcentration(pm10)) {
    const pm10Aqi = computeSubIndex(pm10, PM10_BANDS);
    if (pm10Aqi > maxAqi) {
      maxAqi = pm10Aqi;
      dominantPollutant = 'PM10';
    }
  }

  if (isValidConcentration(no2)) {
    const no2Aqi = computeSubIndex(no2, NO2_BANDS);
    if (no2Aqi > maxAqi) {
      maxAqi = no2Aqi;
      dominantPollutant = 'NO2';
    }
  }

  const aqi = Math.max(0, Math.min(500, maxAqi));
  return {
    aqi,
    band: mapCpcbAqiToBand(aqi),
    dominantPollutant,
  };
}
