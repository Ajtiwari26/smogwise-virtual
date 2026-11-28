/**
 * Grounded AI Briefing card displaying Gemini selections or a deterministic preview.
 */

import type { DeterministicReport, LanguageCode } from '../domain/types.js';
import type { PlanBriefingApiResponse } from '../services/apiClient.js';
import { formatGeminiLabel } from './modelAttribution.js';

/** Props for the AiPlanBriefingCard component. */
export interface AiPlanBriefingCardProps {
  readonly report: DeterministicReport;
  readonly briefing: PlanBriefingApiResponse | undefined;
  readonly isLoading: boolean;
  readonly language: LanguageCode;
  readonly hasOverBudgetSelection?: boolean;
  readonly briefingFailed?: boolean;
}

const PREVIEW_CITATION_KEYS = [
  'CALC:DOSE_BEFORE',
  'CALC:DOSE_AFTER',
  'CALC:INDOOR_PM25',
  'CALC:CO2E_SAVED',
  'AQ:SOURCE',
] as const;

function formatPreviewCo2Clause(rawCo2: number, isHindi: boolean): string {
  if (rawCo2 >= 0) {
    return isHindi
      ? `और रोज़ाना ${String(rawCo2)} g CO2e बचाते हैं`
      : `while saving ${String(rawCo2)} g CO2e/day`;
  }
  const absCo2 = String(Math.abs(rawCo2));
  return isHindi
    ? `(बेसलाइन से +${absCo2} g CO2e/दिन अधिक)`
    : `(+${absCo2} g CO2e/day above baseline)`;
}

function formatPreviewBudgetNote(hasOverBudgetSelection: boolean, isHindi: boolean): string {
  if (hasOverBudgetSelection) {
    return isHindi
      ? 'चयनित उपायों का कुल मासिक खर्च आपके बजट से अधिक है।'
      : 'The total monthly cost of selected actions exceeds your budget.';
  }
  return isHindi
    ? 'चयनित उपायों का कुल मासिक खर्च आपके बजट में है।'
    : 'The total monthly cost of selected actions is within your budget.';
}

function buildPreviewView(
  report: DeterministicReport,
  isHindi: boolean,
  hasOverBudgetSelection: boolean,
): PlanBriefingApiResponse {
  const city = isHindi ? report.city.nameHi : report.city.name;
  const aqi = String(Math.round(report.cpcbAqi));
  const doseBefore = String(Math.round(report.exposure.baselineInhaledUgPerDay));
  const doseAfter = String(Math.round(report.exposure.optimizedInhaledUgPerDay));
  const co2Clause = formatPreviewCo2Clause(
    Math.round(report.emissions.co2eAvoidedGramsPerDay),
    isHindi,
  );
  const budgetNote = formatPreviewBudgetNote(hasOverBudgetSelection, isHindi);
  const citationsUsed = PREVIEW_CITATION_KEYS.filter((key) => Object.hasOwn(report.citations, key));
  const summaryEn =
    `Modeled daily inhaled PM2.5 is ${doseBefore} µg at baseline and ${doseAfter} µg with active measures ` +
    `[CALC:DOSE_AFTER] ${co2Clause} [CALC:CO2E_SAVED]. [AQ:SOURCE]`;
  const summaryHi =
    `बेसलाइन दैनिक PM2.5 खुराक ${doseBefore} µg है और सक्रिय उपायों के साथ ${doseAfter} µg है ` +
    `[CALC:DOSE_AFTER] ${co2Clause} [CALC:CO2E_SAVED]। [AQ:SOURCE]`;
  const firstAction = isHindi
    ? `वर्तमान CPCB AQI ${aqi} के अनुसार घरेलू प्रवेश नियंत्रण प्राथमिकता पर है [AQ:SOURCE]।`
    : `Current CPCB AQI ${aqi} prioritizes indoor infiltration barriers first [AQ:SOURCE].`;
  return {
    headline: isHindi
      ? `${city} के लिए घरेलू वायु सुरक्षा सारांश (AQI ${aqi})`
      : `Household Air Protection Briefing for ${city} (AQI ${aqi})`,
    summary: isHindi ? summaryHi : summaryEn,
    whyActions: [firstAction, budgetNote],
    language: isHindi ? 'hi' : 'en',
    mode: 'offline_grounded',
    citationsUsed,
  };
}

function BriefingHeader(props: {
  readonly isHindi: boolean;
  readonly isLoading: boolean;
  readonly isGemini: boolean;
  readonly modelUsed?: string;
  readonly briefingFailed?: boolean;
}): React.JSX.Element {
  const { isHindi, isLoading, isGemini, modelUsed } = props;
  const geminiLabel = formatGeminiLabel(modelUsed, isHindi);
  const modeLabel = isGemini
    ? geminiLabel
    : (isHindi ? 'टियर-1 सत्यापित सारांश' : 'Tier-1 Grounded Summary');
  const status = props.briefingFailed
    ? (isHindi ? 'ब्रीफिंग उपलब्ध नहीं है। स्थानीय सारांश दिखाया जा रहा है।' :
      'Briefing unavailable. Showing the local summary.')
    : (isLoading ? (isHindi ? 'संश्लेषण हो रहा है…' : 'Synthesizing…') : '');
  const badgeTone = isGemini ? 'bg-teal-50 text-teal-900' : 'bg-slate-100 text-slate-900';

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-teal-800">
        {isHindi ? 'ग्राउंडेड AI ब्रीफिंग' : 'Grounded AI Briefing'}
      </span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-800" aria-live="polite">
          {status}
        </span>
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
          className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-800"
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
  hasOverBudgetSelection = false,
  briefingFailed = false,
}: AiPlanBriefingCardProps): React.JSX.Element {
  const isHindi = language === 'hi';
  if (report.aqStatus === 'unavailable' || report.aqStatus === 'pending') {
    return <p role="status">{isHindi ? 'स्थानीय वायु गुणवत्ता उपलब्ध नहीं है।'
      : 'Local air quality is unavailable.'}</p>;
  }
  const view = briefing ?? buildPreviewView(report, isHindi, hasOverBudgetSelection);
  const whyTitle = isHindi
    ? 'ये उपाय आपके परिवार के लिए क्यों उपयुक्त हैं'
    : 'Why These Actions Fit Your Household';

  return (
    <section
      aria-labelledby="ai-briefing-heading"
      aria-busy={isLoading}
      className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm"
    >
      <BriefingHeader
        isHindi={isHindi}
        isLoading={isLoading}
        briefingFailed={briefingFailed}
        isGemini={view.mode === 'gemini_interactions'}
        {...(view.modelUsed !== undefined ? { modelUsed: view.modelUsed } : {})}
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
