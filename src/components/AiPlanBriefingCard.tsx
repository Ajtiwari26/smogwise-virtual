/**
 * Grounded AI Briefing card displaying Gemini 4 synthesis or deterministic preview.
 */

import type { DeterministicReport, LanguageCode } from '../domain/types.js';
import type { PlanBriefingApiResponse } from '../services/apiClient.js';

export interface AiPlanBriefingCardProps {
  readonly report: DeterministicReport;
  readonly briefing: PlanBriefingApiResponse | undefined;
  readonly isLoading: boolean;
  readonly language: LanguageCode;
}

function buildPreviewView(report: DeterministicReport, isHindi: boolean): PlanBriefingApiResponse {
  const city = isHindi ? report.city.nameHi : report.city.name;
  const aqi = String(Math.round(report.cpcbAqi));
  const doseBefore = String(Math.round(report.exposure.baselineInhaledUgPerDay));
  const doseAfter = String(Math.round(report.exposure.optimizedInhaledUgPerDay));
  const co2Saved = String(Math.round(report.emissions.co2eAvoidedGramsPerDay));
  return {
    headline: isHindi
      ? `${city} के लिए घरेलू वायु सुरक्षा सारांश (AQI ${aqi})`
      : `Household Air Protection Briefing for ${city} (AQI ${aqi})`,
    summary: isHindi
      ? `सक्रिय उपाय दैनिक PM2.5 खुराक को ${doseBefore} µg से घटाकर ${doseAfter} µg करते हैं [CALC:DOSE_AFTER] और रोज़ाना ${co2Saved} g CO2e बचाते हैं [CALC:CO2E_SAVED]।`
      : `Active measures cut daily inhaled PM2.5 from ${doseBefore} µg to ${doseAfter} µg [CALC:DOSE_AFTER] while saving ${co2Saved} g CO2e/day [CALC:CO2E_SAVED].`,
    whyActions: isHindi
      ? [
        `वर्तमान CPCB AQI ${aqi} के अनुसार घरेलू प्रवेश नियंत्रण प्राथमिकता पर है [AQ:SOURCE]।`,
        `चयनित उपाय घर के अंदर PM2.5 स्तर घटाकर अधिकतम सुरक्षा देते हैं [CALC:INDOOR_PM25]।`,
      ]
      : [
        `Current CPCB AQI ${aqi} prioritizes indoor infiltration barriers first [AQ:SOURCE].`,
        `Selected actions lower indoor PM2.5 exposure within budget [CALC:INDOOR_PM25].`,
      ],
    language: isHindi ? 'hi' : 'en',
    mode: 'offline_grounded',
    citationsUsed: Object.keys(report.citations).slice(0, 6),
  };
}

function BriefingHeader(props: {
  readonly isHindi: boolean;
  readonly isLoading: boolean;
  readonly isGemini: boolean;
}): React.JSX.Element {
  const { isHindi, isLoading, isGemini } = props;
  const modeLabel = isGemini
    ? (isHindi ? 'Gemini 4 ग्राउंडेड' : 'Gemini 4 Grounded')
    : (isHindi ? 'टियर-1 सत्यापित सारांश' : 'Tier-1 Grounded Summary');
  const badgeTone = isGemini ? 'bg-teal-50 text-teal-800' : 'bg-slate-100 text-slate-800';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-teal-800">
        {isHindi ? 'ग्राउंडेड AI ब्रीफिंग' : 'Grounded AI Briefing'}
      </span>
      <div className="flex items-center gap-2">
        {isLoading ? (
          <span className="text-xs font-medium text-slate-800" aria-live="polite">
            {isHindi ? 'संश्लेषण हो रहा है…' : 'Synthesizing…'}
          </span>
        ) : null}
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeTone}`}>
          {modeLabel}
        </span>
      </div>
    </div>
  );
}

function CitationBadges(props: {
  readonly citations: readonly string[];
  readonly isHindi: boolean;
}): React.JSX.Element | null {
  if (props.citations.length === 0) {
    return null;
  }
  return (
    <div
      className="mt-3 flex flex-wrap gap-1.5"
      aria-label={props.isHindi ? 'सत्यापित उद्धरण' : 'Verified Citations'}
    >
      {props.citations.map((key) => (
        <span
          key={key}
          className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700"
        >
          [{key}]
        </span>
      ))}
    </div>
  );
}

/** Renders grounded AI household briefing with immediate deterministic citation preview. */
export function AiPlanBriefingCard({
  report,
  briefing,
  isLoading,
  language,
}: AiPlanBriefingCardProps): React.JSX.Element {
  const isHindi = language === 'hi';
  const view = briefing ?? buildPreviewView(report, isHindi);
  const whyTitle = isHindi
    ? 'ये उपाय आपके परिवार के लिए क्यों उपयुक्त हैं'
    : 'Why These Actions Fit Your Household';

  return (
    <section
      aria-labelledby="ai-briefing-heading"
      aria-busy={isLoading}
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <BriefingHeader
        isHindi={isHindi}
        isLoading={isLoading}
        isGemini={view.mode === 'gemini_interactions'}
      />
      <h2 id="ai-briefing-heading" className="mt-2 text-base font-semibold text-slate-900">
        {view.headline}
      </h2>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{view.summary}</p>
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">{whyTitle}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-slate-700">
          {view.whyActions.map((item, idx) => (
            <li key={`${String(idx)}-${item}`}>{item}</li>
          ))}
        </ul>
      </div>
      <CitationBadges citations={view.citationsUsed} isHindi={isHindi} />
    </section>
  );
}
