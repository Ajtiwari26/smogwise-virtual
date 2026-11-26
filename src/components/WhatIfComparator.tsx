import React, { useMemo, useState } from 'react';
import { compareWhatIf } from '../domain/impactService.js';
import type {
  CommuteMode,
  CookingFuel,
  LiveAqOverride,
  UserProfile,
  WhatIfDelta,
} from '../domain/types.js';

/** Props for the interactive WhatIfComparator component. */
export interface WhatIfComparatorProps {
  readonly profile: UserProfile;
  readonly liveAq: LiveAqOverride | undefined;
}

const DeltaGrid: React.FC<{ readonly delta: WhatIfDelta; readonly isHi: boolean }> = React.memo(
  function DeltaGrid({ delta, isHi }) {
    const items = [
      { label: isHi ? 'खुराक कमी' : 'Dose Drop', val: `${delta.doseReductionUgPerDay} ug/day` },
      { label: 'CO2e', val: `${delta.co2eAvoidedGramsPerDay} g/day` },
      { label: 'PM2.5', val: `${delta.pm25AvoidedMgPerDay} mg/day` },
      { label: isHi ? 'बचत' : 'Savings', val: `₹${delta.monthlyNetSavingsInr}/mo` },
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

const ALT_COMMUTE_OPTIONS: readonly {
  readonly id: CommuteMode;
  readonly en: string;
  readonly hi: string;
}[] = [
  { id: 'metro_bus', en: 'Metro / Bus', hi: 'मेट्रो / बस' },
  { id: 'two_wheeler', en: 'Two-Wheeler', hi: 'दोपहिया वाहन' },
  { id: 'carpool', en: 'Carpool', hi: 'कारपूल' },
  { id: 'wfh_walk', en: 'WFH / Walk', hi: 'घर से काम / पैदल' },
  { id: 'petrol_car', en: 'Petrol Car', hi: 'पेट्रोल कार' },
];

function pickDefaultAltCommute(mode: CommuteMode): CommuteMode {
  return mode === 'metro_bus' ? 'wfh_walk' : 'metro_bus';
}

function pickDefaultAltFuel(fuel: CookingFuel): CookingFuel {
  return fuel === 'induction' ? 'lpg' : 'induction';
}

const ALT_FUEL_OPTIONS: readonly {
  readonly id: CookingFuel;
  readonly en: string;
  readonly hi: string;
}[] = [
  { id: 'induction', en: 'Induction', hi: 'इंडक्शन' },
  { id: 'lpg', en: 'LPG', hi: 'एलपीजी' },
  { id: 'biomass_chulha', en: 'Biomass', hi: 'बायोमास' },
];

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
      <div>
        <label htmlFor="whatif-commute" className="block text-xs font-semibold text-slate-800">
          {isHi ? 'वैकल्पिक यात्रा' : 'Alternative Commute'}
        </label>
        <select
          id="whatif-commute"
          value={altCommute}
          onChange={(e) => onCommute(e.target.value as CommuteMode)}
          className="mt-1 w-full rounded border border-slate-400 bg-white px-2 py-1.5 text-xs text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {ALT_COMMUTE_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {isHi ? opt.hi : opt.en}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="whatif-fuel" className="block text-xs font-semibold text-slate-800">
          {isHi ? 'वैकल्पिक ईंधन' : 'Alternative Fuel'}
        </label>
        <select
          id="whatif-fuel"
          value={altFuel}
          onChange={(e) => onFuel(e.target.value as CookingFuel)}
          className="mt-1 w-full rounded border border-slate-400 bg-white px-2 py-1.5 text-xs text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {ALT_FUEL_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {isHi ? opt.hi : opt.en}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2 pb-1.5">
        <input
          id="whatif-corsi"
          type="checkbox"
          checked={addCorsiBox}
          onChange={(e) => onCorsi(e.target.checked)}
          className="h-4 w-4 rounded border-slate-400 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <label htmlFor="whatif-corsi" className="text-xs font-semibold text-slate-800">
          {isHi ? 'DIY कोर्सी-रोसेन्थल बॉक्स जोड़ें' : 'Add DIY Corsi-Rosenthal Box'}
        </label>
      </div>
    </div>
  );
});

/** Side-by-side 2-choice scenario comparator computing instant Tier 1 deltas. */
export const WhatIfComparator: React.FC<WhatIfComparatorProps> = React.memo(
  function WhatIfComparator({ profile, liveAq }) {
    const isHi = profile.language === 'hi';
    const [altCommute, setAltCommute] = useState<CommuteMode>(() =>
      pickDefaultAltCommute(profile.commuteMode),
    );
    const [altFuel, setAltFuel] = useState<CookingFuel>(() =>
      pickDefaultAltFuel(profile.cookingFuel),
    );
    const [addCorsiBox, setAddCorsiBox] = useState<boolean>(true);

    const comparison = useMemo(() => {
      const nextHacks = addCorsiBox
        ? Array.from(new Set([...profile.activeHacks, 'corsi_rosenthal_box' as const]))
        : profile.activeHacks;
      const alternative: UserProfile = {
        ...profile,
        commuteMode: altCommute,
        cookingFuel: altFuel,
        activeHacks: nextHacks,
      };
      return compareWhatIf(profile, alternative, liveAq);
    }, [profile, liveAq, altCommute, altFuel, addCorsiBox]);

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
          altCommute={altCommute}
          altFuel={altFuel}
          addCorsiBox={addCorsiBox}
          isHi={isHi}
          onCommute={setAltCommute}
          onFuel={setAltFuel}
          onCorsi={setAddCorsiBox}
        />
        <div aria-live="polite">
          <DeltaGrid delta={comparison.delta} isHi={isHi} />
          <p className="mt-2.5 text-xs text-slate-800">
            {isHi ? comparison.explanation.hi : comparison.explanation.en}
          </p>
        </div>
      </section>
    );
  },
);
