import React, { useMemo } from 'react';
import type {
  DeterministicReport,
  HourlyExposurePoint,
  LanguageCode,
} from '../domain/types.js';

/** Props for the ImpactDashboard component. */
export interface ImpactDashboardProps {
  readonly report: DeterministicReport;
  readonly language: LanguageCode;
}

interface DiurnalChartProps {
  readonly series: readonly HourlyExposurePoint[];
  readonly language: LanguageCode;
}

function buildPolylinePoints(
  series: readonly HourlyExposurePoint[],
  maxVal: number,
  width: number,
  height: number,
  pad: number,
  getter: (p: HourlyExposurePoint) => number,
): string {
  return series
    .map((pt, idx) => {
      const x = pad + (idx / Math.max(1, series.length - 1)) * (width - pad * 2);
      const y = height - pad - (getter(pt) / maxVal) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const DiurnalSvgChart: React.FC<DiurnalChartProps> = React.memo(function DiurnalSvgChart({
  series,
  language,
}) {
  const isHi = language === 'hi';
  const maxVal = useMemo(() => {
    const vals = series.map((p) => Math.max(p.outdoorPm25, p.optimizedIndoorPm25));
    return Math.max(100, ...vals);
  }, [series]);

  const width = 480;
  const height = 160;
  const pad = 24;
  const outdoorPts = buildPolylinePoints(series, maxVal, width, height, pad, (p) => p.outdoorPm25);
  const indoorPts = buildPolylinePoints(
    series,
    maxVal,
    width,
    height,
    pad,
    (p) => p.optimizedIndoorPm25,
  );

  return (
    <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-800">
        <span>{isHi ? '24-घंटे बाहरी बनाम इनडोर PM2.5' : '24h Diurnal Outdoor vs Indoor PM2.5'}</span>
        <span>
          <span className="text-orange-900">■ {isHi ? 'बाहरी' : 'Outdoor'}</span> ·{' '}
          <span className="text-teal-800">■ {isHi ? 'इनडोर' : 'Indoor'}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="img"
        aria-label={
          isHi
            ? '24 घंटे का बाहरी और इनडोर PM2.5 चार्ट'
            : '24-hour diurnal outdoor versus optimized indoor PM2.5 chart'
        }
        className="h-40 w-full"
      >
        <title>
          {isHi
            ? '24 घंटे बाहरी बनाम इनडोर PM2.5 ग्राफ'
            : '24-Hour Outdoor vs Optimized Indoor PM2.5 Profile'}
        </title>
        <desc>
          {isHi
            ? 'सुबह और शाम स्मॉग पीक तथा दोपहर 13:00-16:00 वेंटिलेशन विंडो को दर्शाता है।'
            : 'Shows morning and evening inversion peaks and 13:00-16:00 safe ventilation window.'}
        </desc>
        {series.map((pt, idx) => {
          if (!pt.isOptimalVentilation) {
            return null;
          }
          const x = pad + (idx / Math.max(1, series.length - 1)) * (width - pad * 2);
          return (
            <rect
              key={pt.hour}
              x={x - 8}
              y={pad}
              width={16}
              height={height - pad * 2}
              fill="#ccfbf1"
            />
          );
        })}
        <polyline fill="none" stroke="#9a3412" strokeWidth="2.5" points={outdoorPts} />
        <polyline fill="none" stroke="#0f766e" strokeWidth="2.5" points={indoorPts} />
      </svg>
      <p className="mt-1.5 text-[11px] text-slate-700">
        {isHi
          ? 'मान्यता: एकल-ज़ोन मिश्रित कमरा मॉडल; हरा क्षेत्र (13:00–16:00) सुरक्षित वेंटिलेशन विंडो है।'
          : 'Model note: Single well-mixed room zone; shaded band (13:00–16:00) marks optimal ventilation.'}
      </p>
    </div>
  );
});

/** Displays Before vs After exposure, indoor PM2.5, CO2e avoided, INR savings, and 24h chart. */
export const ImpactDashboard: React.FC<ImpactDashboardProps> = React.memo(
  function ImpactDashboard({ report, language }) {
    const isHi = language === 'hi';
    const { exposure, emissions, citations } = report;

    const cards = [
      {
        title: isHi ? 'दैनिक PM2.5 खुराक' : 'Inhaled PM2.5 Dose',
        value: `${String(exposure.optimizedInhaledUgPerDay)} ug/day`,
        sub: `${String(exposure.baselineInhaledUgPerDay)} -> -${String(exposure.doseReductionPercent)}%`,
      },
      {
        title: isHi ? 'इनडोर PM2.5' : 'Indoor PM2.5',
        value: `${String(exposure.optimizedIndoorPm25)} ug/m3`,
        sub: `${isHi ? 'पहले' : 'Before'}: ${String(exposure.baselineIndoorPm25)} ug/m3`,
      },
      {
        title: isHi ? 'CO2e बचत' : 'CO2e Avoided',
        value: `${String(emissions.co2eAvoidedGramsPerDay)} g/day`,
        sub: `PM2.5: ${String(emissions.pm25AvoidedMgPerDay)} mg/day`,
      },
      {
        title: isHi ? 'मासिक शुद्ध बचत' : 'Monthly Net Savings',
        value: `₹${String(emissions.monthlyNetSavingsInr)}/mo`,
        sub: `${isHi ? 'वेंटिलेशन' : 'Ventilate'}: ${exposure.optimalVentilationWindow}`,
      },
    ];

    return (
      <section
        id="impact"
        aria-labelledby="impact-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <h2 id="impact-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'प्रत्यक्ष स्वास्थ्य और उत्सर्जन प्रभाव' : 'Direct Health & Emissions Impact'}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.title} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{card.title}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{card.value}</p>
              <p className="text-xs text-slate-700">{card.sub}</p>
            </div>
          ))}
        </div>
        {exposure.hourlySeries !== undefined && exposure.hourlySeries.length > 0 && (
          <DiurnalSvgChart series={exposure.hourlySeries} language={language} />
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Object.entries(citations).map(([key, val]) => (
            <span
              key={key}
              title={val}
              className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800"
            >
              [{key}]
            </span>
          ))}
        </div>
      </section>
    );
  },
);