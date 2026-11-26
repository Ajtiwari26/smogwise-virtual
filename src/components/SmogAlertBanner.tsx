import React from 'react';
import { computeCpcbAqi } from '../domain/cpcbAqi.js';
import type { CityPreset, DominantPollutant, LanguageCode } from '../domain/types.js';

/** Props for the SmogAlertBanner component. */
export interface SmogAlertBannerProps {
  readonly city: CityPreset;
  readonly language: LanguageCode;
  readonly optimalVentilationWindow: string;
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

interface AqiBandInfo {
  readonly label: string;
  readonly labelHi: string;
  readonly isSevere: boolean;
  readonly badgeClass: string;
  readonly bannerClass: string;
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

function buildActionText(isUrgent: boolean, isHi: boolean, windowText: string): string {
  if (isUrgent) {
    return isHi
      ? `आपातकालीन सलाह: खिड़कियाँ सील रखें, बाहर N95 पहनें और केवल ${windowText} में वेंटिलेशन करें।`
      : `Urgent action: Seal windows, wear fitted N95 outdoors, and ventilate only during ${windowText}.`;
  }
  return isHi
    ? `सुझाव: सुबह के स्मॉग से बचें और ${windowText} के बीच खिड़कियाँ खोलें।`
    : `Advisory: Limit early-morning outdoor exertion and cross-ventilate during ${windowText}.`;
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
    : `Nearest station fallback: ${stationName}${distPart}`;
}

interface BannerModel {
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

function formatPollutantSummary(params: {
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
  if (resolvedPm10 !== undefined) parts.push(`PM10: ${String(resolvedPm10)} ug/m3`);
  if (resolvedNo2 !== undefined) parts.push(`NO2: ${String(resolvedNo2)} ug/m3`);
  if (istTime !== undefined) parts.push(istTime);
  return parts.join(' · ');
}

function buildBannerModel(props: SmogAlertBannerProps): BannerModel {
  const { city, language, optimalVentilationWindow, dataSource = 'city_preset' } = props;
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
    actionText: buildActionText(isUrgent, isHi, optimalVentilationWindow),
    fallbackText: props.fallbackStationName !== undefined
      ? formatFallbackText(props.fallbackStationName, props.fallbackDistanceKm, isHi)
      : undefined,
  };
}

interface BannerBadgesRowProps {
  readonly city: CityPreset;
  readonly model: BannerModel;
  readonly pollutantSummary: string;
}

function BannerBadgesRow({
  city,
  model,
  pollutantSummary,
}: BannerBadgesRowProps): React.ReactElement {
  const { isHi, resolvedAqi, resolvedDominant, band, sourceLabel } = model;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2.5 py-0.5 text-xs font-bold ${band.badgeClass}`}>
          CPCB AQI {resolvedAqi} · {isHi ? band.labelHi : band.label}
        </span>
        <span className="rounded border border-slate-500 bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
          {isHi ? 'प्रमुख प्रदूषक' : 'Dominant'}: {resolvedDominant}
        </span>
        <span className="rounded border border-slate-400 bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
          {city.grapStage.replace('_', ' ')}
        </span>
        <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
          {sourceLabel}
        </span>
        <h2 className="text-sm font-bold text-slate-900">{isHi ? city.nameHi : city.name}</h2>
      </div>
      <p className="text-xs font-semibold text-slate-800">{pollutantSummary}</p>
    </div>
  );
}

/** Accessible CPCB smog severity banner with assertive alert on Severe / GRAP-IV. */
export const SmogAlertBanner: React.FC<SmogAlertBannerProps> = React.memo(
  function SmogAlertBanner(props) {
    const { city, aqiError, dataSource = 'city_preset', livePm10, liveNo2 } = props;
    const model = buildBannerModel(props);
    const pollutantSummary = formatPollutantSummary({
      city,
      dataSource,
      livePm10,
      liveNo2,
      istTime: model.istTime,
    });

    return (
      <section
        role={model.isUrgent ? 'alert' : 'status'}
        aria-live={model.isUrgent ? 'assertive' : 'polite'}
        className={`rounded-lg border-l-4 p-4 shadow-sm ${model.band.bannerClass}`}
      >
        <BannerBadgesRow city={city} model={model} pollutantSummary={pollutantSummary} />

        {model.fallbackText !== undefined && (
          <p className="mt-1.5 text-xs font-medium text-slate-800">{model.fallbackText}</p>
        )}

        <p className="mt-2 text-sm font-medium text-slate-900">{model.actionText}</p>

        {aqiError !== undefined && (
          <p
            role="status"
            aria-live="polite"
            className="mt-2 rounded border border-amber-800 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-slate-900"
          >
            {aqiError}
          </p>
        )}
      </section>
    );
  },
);
