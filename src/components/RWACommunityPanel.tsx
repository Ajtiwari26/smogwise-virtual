import React, { useEffect, useRef, useState } from 'react';
import type { EmissionsMetrics, LanguageCode } from '../domain/types.js';

/** Props for the RWACommunityPanel component. */
export interface RWACommunityPanelProps {
  readonly households: number;
  readonly adoptionRate: number;
  readonly emissions: EmissionsMetrics;
  readonly rwaNotice: string;
  readonly language: LanguageCode;
  readonly onHouseholdsChange: (count: number) => void;
  readonly onAdoptionChange: (rate: number) => void;
}

interface RwaRangeFieldProps {
  readonly id: string;
  readonly label: string;
  readonly valueText: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly hint: string;
  readonly onChange: (value: number) => void;
}

const RwaRangeField: React.FC<RwaRangeFieldProps> = React.memo(function RwaRangeField({
  id,
  label,
  valueText,
  min,
  max,
  step,
  value,
  hint,
  onChange,
}) {
  const invalid = !Number.isFinite(value) || value < min || value > max;
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
        {label}: {valueText}
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-describedby={hintId}
        aria-invalid={invalid}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-teal-700"
      />
      <span id={hintId} className="mt-0.5 block text-[11px] text-slate-700">
        {hint}
      </span>
    </div>
  );
});

const RwaNoticeBox: React.FC<{
  readonly rwaNotice: string;
  readonly isHi: boolean;
  readonly copied: boolean;
  readonly onCopy: () => void;
}> = React.memo(function RwaNoticeBox({ rwaNotice, isHi, copied, onCopy }) {
  const statusText = copied ? (isHi ? 'कॉपी हो गया!' : 'Copied to clipboard!') : '';
  return (
    <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-3">
      <p className="whitespace-pre-line text-xs text-slate-800">{rwaNotice}</p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={onCopy}
          className="rounded bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {isHi ? 'RWA नोटिस कॉपी करें' : 'Copy RWA Notice'}
        </button>
        <span aria-live="polite" className="text-xs font-semibold text-teal-800">
          {statusText}
        </span>
      </div>
    </div>
  );
});

const RwaMetricsGrid: React.FC<{
  readonly emissions: EmissionsMetrics;
  readonly isHi: boolean;
}> = React.memo(function RwaMetricsGrid({ emissions, isHi }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
      <div className="rounded bg-teal-50 p-2.5 text-slate-900">
        <span className="block font-semibold text-teal-900">
          {isHi ? 'मासिक सामुदायिक CO2e बचत' : 'Community CO2e Avoided / mo'}
        </span>
        <strong className="text-base">{emissions.communityCo2eAvoidedKgPerMonth} kg</strong>
      </div>
      <div className="rounded bg-teal-50 p-2.5 text-slate-900">
        <span className="block font-semibold text-teal-900">
          {isHi ? 'मासिक सामुदायिक PM2.5 बचत' : 'Community PM2.5 Avoided / mo'}
        </span>
        <strong className="text-base">{emissions.communityPm25AvoidedGramsPerMonth} g</strong>
      </div>
    </div>
  );
});

/** RWA neighborhood multiplier sliders and copyable WhatsApp/Noticeboard template. */
export const RWACommunityPanel: React.FC<RWACommunityPanelProps> = React.memo(
  function RWACommunityPanel({
    households,
    adoptionRate,
    emissions,
    rwaNotice,
    language,
    onHouseholdsChange,
    onAdoptionChange,
  }) {
    const isHi = language === 'hi';
    const [copied, setCopied] = useState<boolean>(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const adoptionPct = Math.round(adoptionRate * 100);

    useEffect(() => () => clearTimeout(timerRef.current), []);

    const handleCopy = (): void => {
      if (typeof navigator !== 'undefined' && navigator.clipboard !== undefined) {
        void navigator.clipboard.writeText(rwaNotice).then(() => {
          setCopied(true);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setCopied(false), 2500);
        });
      }
    };

    return (
      <section
        id="rwa"
        aria-labelledby="rwa-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <h2 id="rwa-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'RWA और समुदाय का सामूहिक प्रभाव' : 'RWA & Neighborhood Multiplier'}
        </h2>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RwaRangeField
            id="rwa-households"
            label={isHi ? 'फ्लैट / परिवारों की संख्या' : 'Households in Society'}
            valueText={String(households)}
            min={10}
            max={500}
            step={10}
            value={households}
            hint={isHi ? 'अनुमत सीमा: 10 से 500 परिवार' : 'Allowed range: 10 to 500 households'}
            onChange={onHouseholdsChange}
          />
          <RwaRangeField
            id="rwa-adoption"
            label={isHi ? 'भागीदारी दर' : 'Adoption Rate'}
            valueText={`${String(adoptionPct)}%`}
            min={10}
            max={100}
            step={5}
            value={adoptionPct}
            hint={isHi ? 'अनुमत सीमा: 10% से 100%' : 'Allowed range: 10% to 100%'}
            onChange={(pct) => onAdoptionChange(pct / 100)}
          />
        </div>
        <RwaMetricsGrid emissions={emissions} isHi={isHi} />
        <RwaNoticeBox rwaNotice={rwaNotice} isHi={isHi} copied={copied} onCopy={handleCopy} />
      </section>
    );
  },
);
