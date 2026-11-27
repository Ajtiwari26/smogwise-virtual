/**
 * Pure presentation model and bilingual CPCB AQI formatting helpers for SmogAlertBanner.
 */

import { computeCpcbAqi } from '../domain/cpcbAqi.js';
import type { CityPreset, DominantPollutant, LanguageCode } from '../domain/types.js';
import { formatAfternoonVentilation } from '../domain/ventilation.js';

/** Props for the SmogAlertBanner component. */
export interface SmogAlertBannerProps {
  readonly city: CityPreset;
  readonly language: LanguageCode;
  readonly optimalVentilationWindow: string;
  readonly canVentilate?: boolean;
  readonly dataSource?: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi?: number;
  readonly dominantPollutant?: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
  readonly livePm10?: number;
  readonly liveNo2?: number;
  readonly aqiError?: string;
}

/** Visual and semantic classification of a CPCB AQI band. */
export interface AqiBandInfo {
  readonly label: string;
  readonly labelHi: string;
  readonly isSevere: boolean;
  readonly badgeClass: string;
  readonly bannerClass: string;
}

/** Precomputed presentation state for SmogAlertBanner. */
export interface BannerModel {
  readonly isHi: boolean;
  readonly resolvedAqi: number;
  readonly resolvedDominant: DominantPollutant;
  readonly band: AqiBandInfo;
  readonly isUrgent: boolean;
  readonly istTime: string | undefined;
  readonly sourceLabel: string;
  readonly actionText: string;
  readonly fallbackText: string | undefined;
}

const BAND_GOOD: AqiBandInfo = {
  label: 'Good',
  labelHi: 'अच्छा (Good)',
  isSevere: false,
  badgeClass: 'bg-teal-800 text-white',
  bannerClass: 'border-teal-700 bg-teal-50 text-slate-900',
};
const BAND_SATISFACTORY: AqiBandInfo = {
  label: 'Satisfactory',
  labelHi: 'संतोषजनक (Satisfactory)',
  isSevere: false,
  badgeClass: 'bg-teal-700 text-white',
  bannerClass: 'border-teal-600 bg-teal-50 text-slate-900',
};
const BAND_MODERATE: AqiBandInfo = {
  label: 'Moderate',
  labelHi: 'मध्यम (Moderate)',
  isSevere: false,
  badgeClass: 'bg-amber-900 text-white',
  bannerClass: 'border-amber-700 bg-amber-50 text-slate-900',
};
const BAND_POOR: AqiBandInfo = {
  label: 'Poor',
  labelHi: 'खराब (Poor)',
  isSevere: false,
  badgeClass: 'bg-orange-900 text-white',
  bannerClass: 'border-orange-700 bg-orange-50 text-slate-900',
};
const BAND_VERY_POOR: AqiBandInfo = {
  label: 'Very Poor',
  labelHi: 'बहुत खराब (Very Poor)',
  isSevere: false,
  badgeClass: 'bg-red-800 text-white',
  bannerClass: 'border-red-700 bg-red-50 text-slate-900',
};
const BAND_SEVERE: AqiBandInfo = {
  label: 'Severe',
  labelHi: 'गंभीर (Severe)',
  isSevere: true,
  badgeClass: 'bg-red-900 text-white',
  bannerClass: 'border-red-900 bg-red-50 text-slate-900',
};

function classifyAqiBand(aqi: number): AqiBandInfo {
  if (aqi <= 50) return BAND_GOOD;
  if (aqi <= 100) return BAND_SATISFACTORY;
  if (aqi <= 200) return BAND_MODERATE;
  if (aqi <= 300) return BAND_POOR;
  if (aqi <= 400) return BAND_VERY_POOR;
  return BAND_SEVERE;
}

function formatIstTimestamp(observedAt?: string): string | undefined {
  if (observedAt === undefined || observedAt.trim().length === 0) {
    return undefined;
  }
  const parsed = Date.parse(observedAt);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  }).format(new Date(parsed));
  return `${formatted} IST`;
}

function buildDataSourceLabel(
  dataSource: 'live_open_meteo' | 'city_preset',
  isHi: boolean,
): string {
  if (dataSource === 'live_open_meteo') {
    return isHi ? 'लाइव Open-Meteo' : 'Live Open-Meteo';
  }
  return isHi ? 'क्यूरेटेड प्रीसेट' : 'Curated Preset';
}

function buildActionText(isUrgent: boolean, props: SmogAlertBannerProps): string {
  const { language, canVentilate = false, optimalVentilationWindow } = props;
  const advice = language === 'hi'
    ? (isUrgent
      ? 'खिड़कियों की दरारें सील करें और बाहर सही फिट वाला N95 पहनें।'
      : 'सुबह बाहर भारी गतिविधि से बचें।')
    : (isUrgent
      ? 'Seal window gaps and wear a fitted N95 outdoors.'
      : 'Limit early-morning outdoor exertion.');
  return `${advice} ${formatAfternoonVentilation(canVentilate, optimalVentilationWindow, language)}`;
}

function formatFallbackText(
  stationName: string,
  distanceKm: number | undefined,
  isHi: boolean,
): string {
  const distPart = distanceKm !== undefined
    ? (isHi ? ` (${String(distanceKm)} km दूर)` : ` (${String(distanceKm)} km away)`)
    : '';
  return isHi
    ? `निकटतम स्टेशन प्रॉक्सी: ${stationName}${distPart}`
    : `Nearest station proxy: ${stationName}${distPart}`;
}

function resolveComputedCpcb(
  city: CityPreset,
  dataSource: 'live_open_meteo' | 'city_preset',
  livePm10: number | undefined,
  liveNo2: number | undefined,
) {
  if (dataSource === 'live_open_meteo') {
    return computeCpcbAqi(city.baselinePm25, livePm10, liveNo2);
  }
  return computeCpcbAqi(city.baselinePm25, city.baselinePm10, city.baselineNo2);
}

/** Formats PM2.5, optional live/preset PM10 & NO2, and IST observation timestamp. */
export function formatPollutantSummary(params: {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly livePm10: number | undefined;
  readonly liveNo2: number | undefined;
  readonly istTime: string | undefined;
}): string {
  const { city, dataSource, livePm10, liveNo2, istTime } = params;
  const resolvedPm10 = dataSource === 'live_open_meteo' ? livePm10 : city.baselinePm10;
  const resolvedNo2 = dataSource === 'live_open_meteo' ? liveNo2 : city.baselineNo2;
  const parts = [`PM2.5: ${String(city.baselinePm25)} ug/m3`];
  if (resolvedPm10 !== undefined && resolvedPm10 > 0) parts.push(`PM10: ${String(resolvedPm10)} ug/m3`);
  if (resolvedNo2 !== undefined && resolvedNo2 > 0) parts.push(`NO2: ${String(resolvedNo2)} ug/m3`);
  if (istTime !== undefined) parts.push(istTime);
  return parts.join(' · ');
}

/** Builds the complete presentation model for SmogAlertBanner. */
export function buildBannerModel(props: SmogAlertBannerProps): BannerModel {
  const { city, language, dataSource = 'city_preset' } = props;
  const isHi = language === 'hi';
  const computed = resolveComputedCpcb(city, dataSource, props.livePm10, props.liveNo2);
  const resolvedAqi = props.cpcbAqi ?? computed.aqi;
  const resolvedDominant = props.dominantPollutant ?? computed.dominantPollutant;
  const band = classifyAqiBand(resolvedAqi);
  const isUrgent = band.isSevere || city.grapStage === 'GRAP_IV';

  return {
    isHi,
    resolvedAqi,
    resolvedDominant,
    band,
    isUrgent,
    istTime: formatIstTimestamp(props.observedAt),
    sourceLabel: buildDataSourceLabel(dataSource, isHi),
    actionText: buildActionText(isUrgent, props),
    fallbackText: props.fallbackStationName !== undefined
      ? formatFallbackText(props.fallbackStationName, props.fallbackDistanceKm, isHi)
      : undefined,
  };
}
