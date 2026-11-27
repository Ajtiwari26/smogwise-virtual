/**
 * Accessible 24-hour diurnal outdoor vs. optimized indoor PM2.5 SVG chart
 * paired with a semantic sr-only summary table via aria-describedby.
 */

import React, { useId, useMemo } from 'react';
import type { HourlyExposurePoint, LanguageCode } from '../domain/types.js';

/** Props for the DiurnalSvgChart component. */
export interface DiurnalChartProps {
  readonly series: readonly HourlyExposurePoint[];
  readonly language: LanguageCode;
}

function sanitizeFinite(val: number): number {
  return Number.isFinite(val) ? Math.max(0, val) : 0;
}

function buildPolylinePoints(
  series: readonly HourlyExposurePoint[],
  maxVal: number,
  width: number,
  height: number,
  pad: number,
  getter: (p: HourlyExposurePoint) => number,
): string {
  const safeMax = Number.isFinite(maxVal) && maxVal > 0 ? maxVal : 100;
  return series
    .map((pt, idx) => {
      const x = pad + (idx / Math.max(1, series.length - 1)) * (width - pad * 2);
      const y = height - pad - (sanitizeFinite(getter(pt)) / safeMax) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

const DiurnalSummaryTable: React.FC<DiurnalChartProps & { readonly tableId: string }> = React.memo(
  function DiurnalSummaryTable({ series, language, tableId }) {
    const isHi = language === 'hi';
    const targetHours = [7, 14, 20, 1];
    const keyRows = targetHours
      .map((hr) => series.find((pt) => pt.hour === hr))
      .filter((pt): pt is HourlyExposurePoint => pt !== undefined);
    const rows = keyRows.length > 0 ? keyRows : series.slice(0, 4);
    const count = Math.max(1, series.length);
    const avgOutdoor = Math.round(
      series.reduce((sum, pt) => sum + sanitizeFinite(pt.outdoorPm25), 0) / count,
    );
    const avgIndoor = Math.round(
      series.reduce((sum, pt) => sum + sanitizeFinite(pt.optimizedIndoorPm25), 0) / count,
    );

    return (
      <table id={tableId} className="sr-only">
        <caption>
          {isHi
            ? '24 घंटे बाहरी बनाम अनुकूलित इनडोर PM2.5 तुलना (µg/m³)'
            : '24-hour Outdoor vs Optimized Indoor PM2.5 Comparison (ug/m3)'}
        </caption>
        <thead>
          <tr>
            <th scope="col">{isHi ? 'समय अवधि' : 'Time Period'}</th>
            <th scope="col">{isHi ? 'बाहरी PM2.5 (ug/m3)' : 'Outdoor PM2.5 (ug/m3)'}</th>
            <th scope="col">{isHi ? 'इनडोर PM2.5 (ug/m3)' : 'Optimized Indoor PM2.5 (ug/m3)'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((pt) => (
            <tr key={pt.hour}>
              <th scope="row">{pt.label}</th>
              <td>{Math.round(sanitizeFinite(pt.outdoorPm25))}</td>
              <td>{Math.round(sanitizeFinite(pt.optimizedIndoorPm25))}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">{isHi ? '24-घंटे औसत' : '24h Average'}</th>
            <td>{avgOutdoor}</td>
            <td>{avgIndoor}</td>
          </tr>
        </tbody>
      </table>
    );
  },
);

interface DiurnalSvgBodyProps {
  readonly series: readonly HourlyExposurePoint[];
  readonly isHi: boolean;
  readonly tableId: string;
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  readonly outdoorPts: string;
  readonly indoorPts: string;
}

const DiurnalSvgBody: React.FC<DiurnalSvgBodyProps> = React.memo(function DiurnalSvgBody({
  series,
  isHi,
  tableId,
  width,
  height,
  pad,
  outdoorPts,
  indoorPts,
}) {
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      role="img"
      aria-label={
        isHi
          ? '24 घंटे का बाहरी और इनडोर PM2.5 चार्ट'
          : '24-hour diurnal outdoor versus optimized indoor PM2.5 chart'
      }
      aria-describedby={tableId}
      className="h-40 w-full"
    >
      <title>
        {isHi
          ? '24 घंटे बाहरी बनाम इनडोर PM2.5 ग्राफ'
          : '24-Hour Outdoor vs Optimized Indoor PM2.5 Profile'}
      </title>
      <desc>
        {isHi
          ? 'सुबह और शाम के स्मॉग पीक और हवा बदलने के लिए उपयुक्त घंटों को दर्शाता है।'
          : 'Shows morning and evening inversion peaks and any hours suitable for ventilation.'}
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
            aria-hidden="true"
          />
        );
      })}
      <polyline fill="none" stroke="#9a3412" strokeWidth="2.5" points={outdoorPts} aria-hidden="true" />
      <polyline fill="none" stroke="#0f766e" strokeWidth="2.5" points={indoorPts} aria-hidden="true" />
    </svg>
  );
});

const SVG_WIDTH = 480;
const SVG_HEIGHT = 160;
const SVG_PAD = 24;

const DiurnalChartLegend: React.FC<{ readonly isHi: boolean }> = React.memo(
  function DiurnalChartLegend({ isHi }) {
    return (
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-semibold text-slate-800">
        <span>
          {isHi ? '24-घंटे बाहरी बनाम इनडोर PM2.5' : '24h Diurnal Outdoor vs Indoor PM2.5'}
        </span>
        <span>
          <span className="text-orange-900">
            <span aria-hidden="true">■</span> {isHi ? 'बाहरी' : 'Outdoor'}
          </span>{' '}
          ·{' '}
          <span className="text-teal-800">
            <span aria-hidden="true">■</span> {isHi ? 'इनडोर' : 'Indoor'}
          </span>
        </span>
      </div>
    );
  },
);

/** Renders the 24-hour diurnal PM2.5 curve with an accessible linked summary table. */
export const DiurnalSvgChart: React.FC<DiurnalChartProps> = React.memo(function DiurnalSvgChart({
  series,
  language,
}) {
  const isHi = language === 'hi';
  const tableId = useId();
  const maxVal = useMemo(() => {
    const vals = series.map((p) =>
      Math.max(sanitizeFinite(p.outdoorPm25), sanitizeFinite(p.optimizedIndoorPm25)),
    );
    return Math.max(100, ...vals);
  }, [series]);
  const outdoorPts = buildPolylinePoints(
    series,
    maxVal,
    SVG_WIDTH,
    SVG_HEIGHT,
    SVG_PAD,
    (p) => p.outdoorPm25,
  );
  const indoorPts = buildPolylinePoints(
    series,
    maxVal,
    SVG_WIDTH,
    SVG_HEIGHT,
    SVG_PAD,
    (p) => p.optimizedIndoorPm25,
  );

  return (
    <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 p-3">
      <DiurnalChartLegend isHi={isHi} />
      <DiurnalSvgBody
        series={series}
        isHi={isHi}
        tableId={tableId}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        pad={SVG_PAD}
        outdoorPts={outdoorPts}
        indoorPts={indoorPts}
      />
      <DiurnalSummaryTable series={series} language={language} tableId={tableId} />
      <p className="mt-1.5 text-xs text-slate-700">
        {isHi
          ? 'एकल-ज़ोन कमरा मॉडल। हरा रंग हवा बदलने के लिए उपयुक्त घंटे दिखाता है।'
          : 'Single well-mixed room model. Shading marks hours suitable for ventilation.'}
      </p>
    </div>
  );
});
