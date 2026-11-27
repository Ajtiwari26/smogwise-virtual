/**
 * Direct Health & Emissions Impact summary cards, 24h diurnal chart, and citation explorer.
 */

import React from 'react';
import type { DeterministicReport, LanguageCode } from '../domain/types.js';
import { DiurnalSvgChart } from './DiurnalChart.js';

/** Props for the ImpactDashboard component. */
export interface ImpactDashboardProps {
  readonly report: DeterministicReport;
  readonly language: LanguageCode;
}

const METRIC_TEXT = {
  en: {
    perDay: 'day',
    perMo: 'mo',
    before: 'Before',
    ventilate: 'Afternoon air check',
    doseTitle: 'Inhaled PM2.5 Dose',
    indoorTitle: 'Indoor PM2.5',
    co2eTitle: 'CO2e Avoided',
    savingsTitle: 'Monthly Net Savings',
  },
  hi: {
    perDay: 'दिन',
    perMo: 'माह',
    before: 'पहले',
    ventilate: 'दोपहर की वायु जाँच',
    doseTitle: 'दैनिक PM2.5 खुराक',
    indoorTitle: 'इनडोर PM2.5',
    co2eTitle: 'CO2e बचत',
    savingsTitle: 'मासिक शुद्ध बचत',
  },
} as const;

function buildImpactCards(
  report: DeterministicReport,
  language: LanguageCode,
): readonly { readonly title: string; readonly value: string; readonly sub: string }[] {
  const t = METRIC_TEXT[language];
  const { exposure, emissions } = report;
  return [
    {
      title: t.doseTitle,
      value: `${String(exposure.optimizedInhaledUgPerDay)} ug/${t.perDay}`,
      sub: `${String(exposure.baselineInhaledUgPerDay)} -> -${String(exposure.doseReductionPercent)}%`,
    },
    {
      title: t.indoorTitle,
      value: `${String(exposure.optimizedIndoorPm25)} ug/m3`,
      sub: `${t.before}: ${String(exposure.baselineIndoorPm25)} ug/m3`,
    },
    {
      title: t.co2eTitle,
      value: `${String(emissions.co2eAvoidedGramsPerDay)} g/${t.perDay}`,
      sub: `PM2.5: ${String(emissions.pm25AvoidedMgPerDay)} mg/${t.perDay}`,
    },
    {
      title: t.savingsTitle,
      value: `₹${String(emissions.monthlyNetSavingsInr)}/${t.perMo}`,
      sub: `${t.ventilate}: ${exposure.optimalVentilationWindow}`,
    },
  ];
}

const CitationPillsSection: React.FC<{
  readonly citations: Readonly<Record<string, string>>;
  readonly isHi: boolean;
}> = React.memo(function CitationPillsSection({ citations, isHi }) {
  const entries = Object.entries(citations);
  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([key, val]) => (
          <span
            key={key}
            aria-label={`${key}: ${val}`}
            className="rounded border border-slate-400 bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-900"
          >
            [{key}]
          </span>
        ))}
      </div>
      <details className="text-xs text-slate-800">
        <summary className="cursor-pointer font-semibold text-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700">
          {isHi ? 'सत्यापित गणना उद्धरण विवरण देखें' : 'Inspect verified calculation citations'}
        </summary>
        <dl className="mt-2 space-y-1 rounded-md border border-slate-300 bg-slate-50 p-2.5">
          {entries.map(([key, val]) => (
            <div key={key} className="flex flex-wrap gap-1">
              <dt className="font-mono font-semibold text-teal-900">[{key}]</dt>
              <dd className="text-slate-800">{val}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
});

/** Displays Before vs After exposure, indoor PM2.5, CO2e avoided, INR savings, and 24h chart. */
export const ImpactDashboard: React.FC<ImpactDashboardProps> = React.memo(
  function ImpactDashboard({ report, language }) {
    const isHi = language === 'hi';
    const { exposure, citations } = report;
    const cards = buildImpactCards(report, language);

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
            <div key={card.title} className="rounded-md border border-slate-300 bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">{card.title}</p>
              <p className="mt-1 text-lg font-bold text-slate-900">{card.value}</p>
              <p className="text-xs text-slate-700">{card.sub}</p>
            </div>
          ))}
        </div>
        {exposure.hourlySeries !== undefined && exposure.hourlySeries.length > 0 && (
          <DiurnalSvgChart series={exposure.hourlySeries} language={language} />
        )}
        <CitationPillsSection citations={citations} isHi={isHi} />
      </section>
    );
  },
);
