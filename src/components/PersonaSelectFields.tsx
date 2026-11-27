/**
 * Shared accessible select-field primitives and enum option parsers for forms.
 */

import React from 'react';
import type { CommuteMode, CookingFuel, PersonaType } from '../domain/types.js';

/** Bilingual select option descriptor. */
export interface BilingualOption<T extends string> {
  readonly id: T;
  readonly en: string;
  readonly hi: string;
}

/** Shared high-contrast input/select border styling (>= 3:1 WCAG 1.4.11). */
export const INPUT_CLS =
  'mt-1 w-full rounded-md border border-slate-500 bg-white px-2.5 py-1.5 ' +
  'text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700';

/** Bilingual household persona options. */
export const PERSONA_OPTIONS: readonly BilingualOption<PersonaType>[] = [
  { id: 'young_family', en: 'Young Family', hi: 'युवा परिवार' },
  {
    id: 'sensitive_household',
    en: 'Sensitive Household (Elderly/Asthma)',
    hi: 'संवेदनशील परिवार (बुजुर्ग/अस्थमा)',
  },
  { id: 'rwa_coordinator', en: 'RWA / Community Coordinator', hi: 'RWA / समुदाय समन्वयक' },
  { id: 'office_commuter', en: 'Daily Office Commuter', hi: 'दैनिक ऑफिस यात्री' },
  { id: 'outdoor_student', en: 'School / Outdoor Student', hi: 'स्कूल / बाहरी छात्र' },
];

/** Bilingual commute mode options. */
export const COMMUTE_OPTIONS: readonly BilingualOption<CommuteMode>[] = [
  { id: 'petrol_car', en: 'Petrol Car', hi: 'पेट्रोल कार' },
  { id: 'two_wheeler', en: 'Two-Wheeler', hi: 'दोपहिया वाहन' },
  { id: 'metro_bus', en: 'Metro / Bus', hi: 'मेट्रो / बस' },
  { id: 'carpool', en: 'Carpool', hi: 'कारपूल' },
  { id: 'wfh_walk', en: 'WFH / Walk', hi: 'घर से काम / पैदल' },
];

/** Bilingual cooking fuel options. */
export const FUEL_OPTIONS: readonly BilingualOption<CookingFuel>[] = [
  { id: 'lpg', en: 'LPG Stove', hi: 'एलपीजी चूल्हा' },
  { id: 'induction', en: 'Induction / Electric', hi: 'इंडक्शन / इलेक्ट्रिक' },
  { id: 'biomass_chulha', en: 'Biomass / Chulha', hi: 'बायोमास / चूल्हा' },
];

function selectEnumOption<T extends string>(
  options: readonly BilingualOption<T>[],
  rawValue: string,
  fallback: T,
): T {
  const match = options.find((opt) => opt.id === rawValue);
  return match !== undefined ? match.id : fallback;
}

/** Props for the reusable accessible SelectField component. */
export interface SelectFieldProps<T extends string> {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly BilingualOption<T>[];
  readonly isHi: boolean;
  readonly className?: string;
  readonly onSelect: (value: T) => void;
}

/** Accessible labeled select control with type-safe enum resolution. */
export function SelectField<T extends string>({
  id,
  label,
  value,
  options,
  isHi,
  className = INPUT_CLS,
  onSelect,
}: SelectFieldProps<T>): React.ReactElement {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onSelect(selectEnumOption(options, e.target.value, value))}
        className={className}
      >
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {isHi ? opt.hi : opt.en}
          </option>
        ))}
      </select>
    </div>
  );
}
