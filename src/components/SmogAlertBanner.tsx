/**
 * Accessible CPCB smog severity banner inside a semantic landmark with clean live announcement.
 */

import React from 'react';
import type { CityPreset } from '../domain/types.js';
import {
  type BannerModel,
  buildBannerModel,
  formatPollutantSummary,
  type SmogAlertBannerProps,
} from './SmogAlertBannerModel.js';

/** Re-exported props interface for SmogAlertBanner. */
export type { SmogAlertBannerProps } from './SmogAlertBannerModel.js';

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
  const { isHi, aqStatus, resolvedAqi, resolvedDominant, band, sourceLabel } = model;
  const showReadings = aqStatus === 'live' || aqStatus === 'nearby_proxy';
  const badgeText = showReadings
    ? `CPCB AQI ${resolvedAqi} · ${isHi ? band.labelHi : band.label}`
    : (isHi ? `CPCB AQI ${band.labelHi}` : `CPCB AQI ${band.label}`);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-2.5 py-0.5 text-xs font-bold ${band.badgeClass}`}>
          {badgeText}
        </span>
        {showReadings && (
          <>
            <span className="rounded border border-slate-500 bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
              {isHi ? 'प्रमुख प्रदूषक' : 'Dominant'}: {resolvedDominant}
            </span>
            <span className="rounded border border-slate-500 bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
              {city.grapStage.replace('_', ' ')}
            </span>
          </>
        )}
        <span className="rounded bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white">
          {sourceLabel}
        </span>
        <h2 id="smog-banner-heading" className="text-sm font-bold text-slate-900">
          {isHi ? city.nameHi : city.name}
        </h2>
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
      aqStatus: model.aqStatus,
      livePm10,
      liveNo2,
      istTime: model.istTime,
      isHi: model.isHi,
    });

    return (
      <section
        aria-labelledby="smog-banner-heading"
        className={`rounded-lg border-l-4 p-4 shadow-sm ${model.band.bannerClass}`}
      >
        <div
          role={model.isUrgent ? 'alert' : 'status'}
          aria-live={model.isUrgent ? 'assertive' : 'polite'}
        >
          <BannerBadgesRow city={city} model={model} pollutantSummary={pollutantSummary} />

          {model.fallbackText !== undefined && (
            <p className="mt-1.5 text-xs font-medium text-slate-800">{model.fallbackText}</p>
          )}

          <p className="mt-2 text-sm font-medium text-slate-900">{model.actionText}</p>

          {aqiError !== undefined && (
            <p className="mt-2 rounded border border-amber-800 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-slate-900">
              {aqiError}
            </p>
          )}
        </div>
      </section>
    );
  },
);
