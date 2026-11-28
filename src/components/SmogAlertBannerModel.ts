/**
 * Pure presentation model and bilingual CPCB AQI formatting helpers for SmogAlertBanner.
 */

import { computeCpcbAqi } from '../domain/cpcbAqi.js';
import type {
  AqResolutionStatus,
  CityPreset,
  DominantPollutant,
  LanguageCode,
} from '../domain/types.js';
import { formatAfternoonVentilation } from '../domain/ventilation.js';

/** Props for the SmogAlertBanner component. */
export interface SmogAlertBannerProps {
  readonly city: CityPreset;
  readonly language: LanguageCode;
  readonly optimalVentilationWindow: string;
  readonly canVentilate?: boolean;
  readonly dataSource?: 'live_open_meteo' | 'city_preset';
  readonly aqStatus?: AqResolutionStatus;
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
  readonly aqStatus: AqResolutionStatus;
  readonly resolvedAqi: number;
  readonly resolvedDominant: DominantPollutant;
  readonly band: AqiBandInfo;
  readonly isUrgent: boolean;
  readonly istTime: string | undefined;
  readonly sourceLabel: string;
  readonly actionText: string;
  readonly fallbackText: string | undefined;
}

const SEVERE_BAND: AqiBandInfo = {
  label: 'Severe', labelHi: 'गंभीर (Severe)', isSevere: true,
  badgeClass: 'bg-red-900 text-white', bannerClass: 'border-red-900 bg-red-50 text-slate-900',
};

const BAND_SPECS: readonly AqiBandInfo[] = [
  {
    label: 'Good', labelHi: 'अच्छा (Good)', isSevere: false,
    badgeClass: 'bg-teal-800 text-white', bannerClass: 'border-teal-700 bg-teal-50 text-slate-900',
  },
  {
    label: 'Satisfactory', labelHi: 'संतोषजनक (Satisfactory)', isSevere: false,
    badgeClass: 'bg-teal-700 text-white', bannerClass: 'border-teal-600 bg-teal-50 text-slate-900',
  },
  {
    label: 'Moderate', labelHi: 'मध्यम (Moderate)', isSevere: false,
    badgeClass: 'bg-amber-900 text-white', bannerClass: 'border-amber-700 bg-amber-50 text-slate-900',
  },
  {
    label: 'Poor', labelHi: 'खराब (Poor)', isSevere: false,
    badgeClass: 'bg-orange-900 text-white', bannerClass: 'border-orange-700 bg-orange-50 text-slate-900',
  },
  {
    label: 'Very Poor', labelHi: 'बहुत खराब (Very Poor)', isSevere: false,
    badgeClass: 'bg-red-800 text-white', bannerClass: 'border-red-700 bg-red-50 text-slate-900',
  },
  SEVERE_BAND,
];

function classifyAqiBand(aqi: number): AqiBandInfo {
  const idx = aqi <= 50 ? 0 : aqi <= 100 ? 1 : aqi <= 200 ? 2 : aqi <= 300 ? 3 : aqi <= 400 ? 4 : 5;
  return BAND_SPECS[idx] ?? SEVERE_BAND;
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
  aqStatus: AqResolutionStatus,
  isHi: boolean,
): string {
  if (aqStatus === 'pending') return isHi ? 'AQ जाँचा जा रहा है…' : 'Syncing AQ…';
  if (aqStatus === 'unavailable') return isHi ? 'लाइव AQ अनुपलब्ध' : 'Live AQ Unavailable';
  if (dataSource === 'live_open_meteo') return isHi ? 'लाइव Open-Meteo' : 'Live Open-Meteo';
  return isHi ? 'क्यूरेटेड प्रीसेट' : 'Curated Preset';
}

function buildUnavailableActionText(props: SmogAlertBannerProps, isHi: boolean): string {
  const city = isHi ? props.city.nameHi : props.city.name;
  return isHi
    ? `${city} के लिए लाइव वायु-गुणवत्ता डेटा उपलब्ध नहीं है (निकटतम स्टेशन 50 km से दूर)। कृपया प्रमुख शहर चुनें या पुनः प्रयास करें।`
    : `Live air-quality readings for ${city} are unavailable (> 50 km from curated stations). Select a major preset city or retry.`;
}

function buildActionText(
  isUrgent: boolean,
  aqStatus: AqResolutionStatus,
  props: SmogAlertBannerProps,
): string {
  const { language, canVentilate = false, optimalVentilationWindow } = props;
  if (aqStatus === 'pending') {
    const city = language === 'hi' ? props.city.nameHi : props.city.name;
    return language === 'hi'
      ? `${city} के लिए लाइव वायु-गुणवत्ता डेटा लोड हो रहा है…`
      : `Fetching live air-quality readings for ${city}…`;
  }
  if (aqStatus === 'unavailable') return buildUnavailableActionText(props, language === 'hi');
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
  aqStatus: AqResolutionStatus,
  isHi: boolean,
): string {
  const distPart = distanceKm !== undefined
    ? (isHi ? ` (${String(distanceKm)} km दूर)` : ` (${String(distanceKm)} km away)`)
    : '';
  if (aqStatus === 'unavailable') {
    return isHi
      ? `निकटतम स्टेशन: ${stationName}${distPart} — 50 km सीमा से बाहर`
      : `Nearest station: ${stationName}${distPart} — outside 50 km fallback range`;
  }
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
  return dataSource === 'live_open_meteo'
    ? computeCpcbAqi(city.baselinePm25, livePm10, liveNo2)
    : computeCpcbAqi(city.baselinePm25, city.baselinePm10, city.baselineNo2);
}

function statusReadingFallback(
  status: AqResolutionStatus | undefined,
  isHi?: boolean,
): string | null {
  if (status === 'pending') return isHi ? 'लाइव माप की प्रतीक्षा…' : 'Awaiting live measurements…';
  if (status === 'unavailable') return isHi ? 'स्थानीय रीडिंग अनुपलब्ध' : 'Local station readings unavailable';
  return null;
}

function pushPollutantPart(parts: string[], label: string, val: number | undefined): void {
  if (val !== undefined && val > 0) parts.push(`${label}: ${String(val)} ug/m3`);
}

/** Formats PM2.5, optional live/preset PM10 & NO2, and IST observation timestamp. */
export function formatPollutantSummary(params: {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly aqStatus?: AqResolutionStatus;
  readonly livePm10: number | undefined;
  readonly liveNo2: number | undefined;
  readonly istTime: string | undefined;
  readonly isHi?: boolean;
}): string {
  const blocked = statusReadingFallback(params.aqStatus, params.isHi);
  if (blocked !== null) return blocked;
  const { city, dataSource, livePm10, liveNo2, istTime } = params;
  const isLive = dataSource === 'live_open_meteo';
  const parts = [`PM2.5: ${String(city.baselinePm25)} ug/m3`];
  pushPollutantPart(parts, 'PM10', isLive ? livePm10 : city.baselinePm10);
  pushPollutantPart(parts, 'NO2', isLive ? liveNo2 : city.baselineNo2);
  if (istTime !== undefined) parts.push(istTime);
  return parts.join(' · ');
}

const BAND_UNAVAILABLE: AqiBandInfo = {
  label: 'Unavailable',
  labelHi: 'अनुपलब्ध',
  isSevere: false,
  badgeClass: 'bg-amber-900 text-white',
  bannerClass: 'border-amber-700 bg-amber-50 text-slate-900',
};

function resolveEffectiveAqStatus(
  aqStatus: AqResolutionStatus | undefined,
  dataSource: 'live_open_meteo' | 'city_preset',
): AqResolutionStatus {
  return aqStatus ?? (dataSource === 'live_open_meteo' ? 'live' : 'nearby_proxy');
}

function isUrgentBannerState(
  status: AqResolutionStatus,
  band: AqiBandInfo,
  city: CityPreset,
): boolean {
  return status !== 'unavailable' && status !== 'pending' &&
    (band.isSevere || city.grapStage === 'GRAP_IV');
}

/** Builds the complete presentation model for SmogAlertBanner. */
export function buildBannerModel(props: SmogAlertBannerProps): BannerModel {
  const { city, language, dataSource = 'city_preset', aqStatus } = props;
  const effectiveStatus = resolveEffectiveAqStatus(aqStatus, dataSource);
  const isHi = language === 'hi';
  const computed = resolveComputedCpcb(city, dataSource, props.livePm10, props.liveNo2);
  const resolvedAqi = props.cpcbAqi ?? computed.aqi;
  const resolvedDominant = props.dominantPollutant ?? computed.dominantPollutant;
  const band = effectiveStatus === 'unavailable' ? BAND_UNAVAILABLE : classifyAqiBand(resolvedAqi);
  const isUrgent = isUrgentBannerState(effectiveStatus, band, city);

  return {
    isHi,
    aqStatus: effectiveStatus,
    resolvedAqi,
    resolvedDominant,
    band,
    isUrgent,
    istTime: formatIstTimestamp(props.observedAt),
    sourceLabel: buildDataSourceLabel(dataSource, effectiveStatus, isHi),
    actionText: buildActionText(isUrgent, effectiveStatus, props),
    fallbackText: props.fallbackStationName !== undefined
      ? formatFallbackText(
        props.fallbackStationName,
        props.fallbackDistanceKm,
        effectiveStatus,
        isHi,
      )
      : undefined,
  };
}
