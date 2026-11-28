/**
 * Interactive 2-choice What-If scenario comparator computing instant Tier 1 deltas.
 */

import React, { useMemo, useState } from 'react';
import { useHouseholdProfile } from '../hooks/useSmogPlanHelpers.js';
import {
  compareWhatIf,
  compareWhatIfFromBaseline,
  extractReportLiveAq,
} from '../domain/impactService.js';
import type {
  CommuteMode,
  DeterministicReport,
  CookingFuel,
  LiveAqOverride,
  UserProfile,
  WhatIfDelta,
} from '../domain/types.js';
import {
  type BilingualOption,
  COMMUTE_OPTIONS,
  FUEL_OPTIONS,
  SelectField,
} from './PersonaSelectFields.js';

/** Props for the interactive WhatIfComparator component. */
export interface WhatIfComparatorProps {
  readonly profile: UserProfile;
  readonly report?: DeterministicReport;
  readonly liveAq: LiveAqOverride | undefined;
}

const WHATIF_SELECT_CLS =
  'mt-1 w-full rounded border border-slate-500 bg-white px-2 py-1.5 text-xs ' +
  'text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700';

const ALT_FUEL_OPTIONS: readonly BilingualOption<CookingFuel>[] = FUEL_OPTIONS.map((item) => ({
  id: item.id,
  en: item.id === 'lpg' ? 'LPG' : item.id === 'induction' ? 'Induction' : 'Biomass',
  hi: item.id === 'lpg' ? 'एलपीजी' : item.id === 'induction' ? 'इंडक्शन' : 'बायोमास',
}));

const DeltaGrid: React.FC<{ readonly delta: WhatIfDelta; readonly isHi: boolean }> = React.memo(
  function DeltaGrid({ delta, isHi }) {
    const dayUnit = isHi ? 'दिन' : 'day';
    const moUnit = isHi ? 'माह' : 'mo';
    const items = [
      { label: isHi ? 'खुराक कमी' : 'Dose Drop', val: `${delta.doseReductionUgPerDay} ug/${dayUnit}` },
      { label: 'CO2e', val: `${delta.co2eAvoidedGramsPerDay} g/${dayUnit}` },
      { label: 'PM2.5', val: `${delta.pm25AvoidedMgPerDay} mg/${dayUnit}` },
      { label: isHi ? 'बचत' : 'Savings', val: `₹${delta.monthlyNetSavingsInr}/${moUnit}` },
    ];
    return (
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="rounded bg-slate-100 p-2">
            <span className="block text-slate-700">{item.label}</span>
            <strong className="text-slate-900">{item.val}</strong>
          </div>
        ))}
      </div>
    );
  },
);

function pickDefaultAltCommute(mode: CommuteMode): CommuteMode {
  return mode === 'metro_bus' ? 'wfh_walk' : 'metro_bus';
}

function pickDefaultAltFuel(fuel: CookingFuel): CookingFuel {
  return fuel === 'induction' ? 'lpg' : 'induction';
}

const WhatIfControls: React.FC<{
  readonly altCommute: CommuteMode;
  readonly altFuel: CookingFuel;
  readonly addCorsiBox: boolean;
  readonly isHi: boolean;
  readonly onCommute: (m: CommuteMode) => void;
  readonly onFuel: (f: CookingFuel) => void;
  readonly onCorsi: (checked: boolean) => void;
}> = React.memo(function WhatIfControls({
  altCommute,
  altFuel,
  addCorsiBox,
  isHi,
  onCommute,
  onFuel,
  onCorsi,
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <SelectField
        id="whatif-commute"
        label={isHi ? 'वैकल्पिक यात्रा' : 'Alternative Commute'}
        value={altCommute}
        options={COMMUTE_OPTIONS}
        isHi={isHi}
        className={WHATIF_SELECT_CLS}
        onSelect={onCommute}
      />
      <SelectField
        id="whatif-fuel"
        label={isHi ? 'वैकल्पिक ईंधन' : 'Alternative Fuel'}
        value={altFuel}
        options={ALT_FUEL_OPTIONS}
        isHi={isHi}
        className={WHATIF_SELECT_CLS}
        onSelect={onFuel}
      />
      <div className="flex items-end gap-2 pb-1.5">
        <input
          id="whatif-corsi"
          type="checkbox"
          checked={addCorsiBox}
          onChange={(e) => onCorsi(e.target.checked)}
          className="h-4 w-4 rounded border-slate-500 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <label htmlFor="whatif-corsi" className="text-xs font-semibold text-slate-800">
          {isHi ? 'DIY कोर्सी-रोसेन्थल बॉक्स जोड़ें' : 'Add DIY Corsi-Rosenthal Box'}
        </label>
      </div>
    </div>
  );
});

function resolveAlternative<T>(
  override: { readonly base: T; readonly alt: T } | null,
  currentBase: T,
  pickDefault: (mode: T) => T,
): T {
  if (override !== null && override.base === currentBase) {
    return override.alt;
  }
  return pickDefault(currentBase);
}

function useWhatIfState(
  profile: UserProfile, liveAq?: LiveAqOverride, report?: DeterministicReport,
) {
  const [commuteOverride, setCommuteOverride] = useState<{
    readonly base: CommuteMode;
    readonly alt: CommuteMode;
  } | null>(null);
  const [fuelOverride, setFuelOverride] = useState<{
    readonly base: CookingFuel;
    readonly alt: CookingFuel;
  } | null>(null);
  const [addCorsiBox, setAddCorsiBox] = useState<boolean>(true);

  const altCommute = resolveAlternative(
    commuteOverride,
    profile.commuteMode,
    pickDefaultAltCommute,
  );
  const altFuel = resolveAlternative(fuelOverride, profile.cookingFuel, pickDefaultAltFuel);
  const householdBase = useHouseholdProfile(profile);

  const comparison = useMemo(() => {
    const nextHacks = addCorsiBox
      ? Array.from(new Set([...householdBase.activeHacks, 'corsi_rosenthal_box' as const]))
      : householdBase.activeHacks;
    const alternative: UserProfile = {
      ...householdBase,
      commuteMode: altCommute,
      cookingFuel: altFuel,
      activeHacks: nextHacks,
    };
    return report === undefined
      ? compareWhatIf(householdBase, alternative, liveAq)
      : compareWhatIfFromBaseline(
        householdBase,
        report,
        alternative,
        extractReportLiveAq(report),
      );
  }, [householdBase, liveAq, report, altCommute, altFuel, addCorsiBox]);

  return {
    altCommute,
    altFuel,
    addCorsiBox,
    comparison,
    setAddCorsiBox,
    handleCommuteChange: (nextAlt: CommuteMode) =>
      setCommuteOverride({ base: profile.commuteMode, alt: nextAlt }),
    handleFuelChange: (nextAlt: CookingFuel) =>
      setFuelOverride({ base: profile.cookingFuel, alt: nextAlt }),
  };
}

/** Side-by-side 2-choice scenario comparator computing instant Tier 1 deltas. */
export const WhatIfComparator: React.FC<WhatIfComparatorProps> = React.memo(
  function WhatIfComparator({ profile, liveAq, report }) {
    const isHi = profile.language === 'hi';
    const state = useWhatIfState(profile, liveAq, report);

    return (
      <section
        id="what-if"
        aria-labelledby="what-if-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <h2 id="what-if-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'क्या होगा यदि? (2-विकल्प तुलना)' : 'What-If 2-Choice Comparator'}
        </h2>
        <WhatIfControls
          altCommute={state.altCommute}
          altFuel={state.altFuel}
          addCorsiBox={state.addCorsiBox}
          isHi={isHi}
          onCommute={state.handleCommuteChange}
          onFuel={state.handleFuelChange}
          onCorsi={state.setAddCorsiBox}
        />
        <DeltaGrid delta={state.comparison.delta} isHi={isHi} />
        <p aria-live="polite" className="mt-2.5 text-xs text-slate-800">
          {isHi ? state.comparison.explanation.hi : state.comparison.explanation.en}
        </p>
      </section>
    );
  },
);
