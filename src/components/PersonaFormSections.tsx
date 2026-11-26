/**
 * Accessible sub-sections for PersonaForm with semantic fieldsets and range validation hints.
 */

import React from 'react';
import { CITY_PRESETS } from '../domain/cityPresets.js';
import type {
  CommuteMode,
  CookingFuel,
  IAQHackDetail,
  IAQHackId,
  LanguageCode,
  LocationSearchItem,
  PersonaType,
  UserProfile,
} from '../domain/types.js';
import { LocationSearchCombobox } from './LocationSearchCombobox.js';

interface BilingualOption<T extends string> {
  readonly id: T;
  readonly en: string;
  readonly hi: string;
}

const PERSONA_OPTIONS: readonly BilingualOption<PersonaType>[] = [
  { id: 'young_family', en: 'Young Family', hi: 'युवा परिवार' },
  { id: 'sensitive_household', en: 'Sensitive Household (Elderly/Asthma)', hi: 'संवेदनशील परिवार (बुजुर्ग/अस्थमा)' },
  { id: 'rwa_coordinator', en: 'RWA / Community Coordinator', hi: 'RWA / समुदाय समन्वयक' },
  { id: 'office_commuter', en: 'Daily Office Commuter', hi: 'दैनिक ऑफिस यात्री' },
  { id: 'outdoor_student', en: 'School / Outdoor Student', hi: 'स्कूल / बाहरी छात्र' },
];

const COMMUTE_OPTIONS: readonly BilingualOption<CommuteMode>[] = [
  { id: 'petrol_car', en: 'Petrol Car', hi: 'पेट्रोल कार' },
  { id: 'two_wheeler', en: 'Two-Wheeler', hi: 'दोपहिया वाहन' },
  { id: 'metro_bus', en: 'Metro / Bus', hi: 'मेट्रो / बस' },
  { id: 'carpool', en: 'Carpool', hi: 'कारपूल' },
  { id: 'wfh_walk', en: 'WFH / Walk', hi: 'घर से काम / पैदल' },
];

const FUEL_OPTIONS: readonly BilingualOption<CookingFuel>[] = [
  { id: 'lpg', en: 'LPG Stove', hi: 'एलपीजी चूल्हा' },
  { id: 'induction', en: 'Induction / Electric', hi: 'इंडक्शन / इलेक्ट्रिक' },
  { id: 'biomass_chulha', en: 'Biomass / Chulha', hi: 'बायोमास / चूल्हा' },
];

export const INPUT_CLS =
  'mt-1 w-full rounded-md border border-slate-400 bg-white px-2.5 py-1.5 ' +
  'text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700';

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

interface NumericBoxProps {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChangeValue: (val: number) => void;
}

function NumericBox(props: NumericBoxProps): React.JSX.Element {
  const { id, label, hint, value, min, max, step, onChangeValue } = props;
  const hintId = `${id}-hint`;
  const isOutOfRange = !Number.isFinite(value) || value < min || value > max;
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-800">{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        {...(step !== undefined ? { step } : {})}
        value={value}
        aria-invalid={isOutOfRange}
        aria-describedby={hintId}
        onChange={(e) => onChangeValue(clampInt(e.target.value, min, min, max))}
        className={INPUT_CLS}
      />
      <span id={hintId} className={`mt-0.5 block text-[11px] ${isOutOfRange ? 'font-semibold text-red-800' : 'text-slate-700'}`}>
        {hint}
      </span>
    </div>
  );
}

export const HouseholdNumericFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function HouseholdNumericFields({ profile, isHi, onUpdate }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <NumericBox
          id="household-size"
          label={isHi ? 'सदस्य संख्या' : 'Household Size'}
          hint={isHi ? 'सीमा: 1–12 सदस्य' : 'Range: 1–12 members'}
          value={profile.householdSize}
          min={1}
          max={12}
          onChangeValue={(householdSize) => onUpdate({ householdSize })}
        />
        <NumericBox
          id="monthly-budget"
          label={isHi ? 'मासिक बजट (₹)' : 'Monthly Budget (₹)'}
          hint={isHi ? 'सीमा: ₹0–₹50,000' : 'Range: ₹0–₹50,000'}
          value={profile.monthlyBudgetInr}
          min={0}
          max={50000}
          step={250}
          onChangeValue={(monthlyBudgetInr) => onUpdate({ monthlyBudgetInr })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumericBox
          id="room-volume"
          label={isHi ? 'कमरे का आयतन (m³)' : 'Room Volume (m³)'}
          hint={isHi ? 'सीमा: 12–500 m³' : 'Range: 12–500 m³'}
          value={profile.roomVolumeM3}
          min={12}
          max={500}
          onChangeValue={(roomVolumeM3) => onUpdate({ roomVolumeM3 })}
        />
        <NumericBox
          id="commute-km"
          label={isHi ? 'दैनिक यात्रा (km)' : 'Commute (km/day)'}
          hint={isHi ? 'सीमा: 0–150 km' : 'Range: 0–150 km'}
          value={profile.commuteDistanceKm}
          min={0}
          max={150}
          onChangeValue={(commuteDistanceKm) => onUpdate({ commuteDistanceKm })}
        />
      </div>
    </>
  );
});

export const LifestyleAndPersonaFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function LifestyleAndPersonaFields({ profile, isHi, onUpdate }) {
  return (
    <>
      <div>
        <label htmlFor="persona-select" className="block text-xs font-semibold text-slate-800">
          {isHi ? 'परिवार का प्रकार' : 'Household Persona'}
        </label>
        <select
          id="persona-select"
          value={profile.persona}
          onChange={(e) => onUpdate({ persona: e.target.value as PersonaType })}
          className={INPUT_CLS}
        >
          {PERSONA_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>{isHi ? opt.hi : opt.en}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <input
          id="vulnerable-member"
          type="checkbox"
          checked={profile.hasVulnerableMember}
          onChange={(e) => onUpdate({ hasVulnerableMember: e.target.checked })}
          className="h-4 w-4 rounded border-slate-400 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <label htmlFor="vulnerable-member" className="text-xs font-semibold text-slate-800">
          {isHi
            ? 'घर में संवेदनशील सदस्य (बच्चे/बुजुर्ग/अस्थमा)'
            : 'Vulnerable member (child / elderly / asthma)'}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="commute-mode" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'यात्रा का माध्यम' : 'Commute Mode'}
          </label>
          <select
            id="commute-mode"
            value={profile.commuteMode}
            onChange={(e) => onUpdate({ commuteMode: e.target.value as CommuteMode })}
            className={INPUT_CLS}
          >
            {COMMUTE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{isHi ? opt.hi : opt.en}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cooking-fuel" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'रसोई ईंधन' : 'Cooking Fuel'}
          </label>
          <select
            id="cooking-fuel"
            value={profile.cookingFuel}
            onChange={(e) => onUpdate({ cookingFuel: e.target.value as CookingFuel })}
            className={INPUT_CLS}
          >
            {FUEL_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{isHi ? opt.hi : opt.en}</option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
});

const CUSTOM_CITY_OPTION = '__custom_location__';

export const LocationSectionFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onSelectLocation: (item: LocationSearchItem) => void;
  readonly onSelectPresetCity: (cityId: string) => void;
}> = React.memo(function LocationSectionFields({
  profile,
  isHi,
  onSelectLocation,
  onSelectPresetCity,
}) {
  const customLoc = profile.customLocation;
  const selectValue = customLoc !== undefined ? CUSTOM_CITY_OPTION : profile.cityId;
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <LocationSearchCombobox
        language={profile.language}
        customLocation={customLoc}
        onSelectLocation={onSelectLocation}
      />
      <div>
        <label htmlFor="form-city-select" className="block text-xs font-semibold text-slate-800">
          {isHi ? 'या प्रमुख शहर प्रीसेट चुनें' : 'Or Select Major City Preset'}
        </label>
        <select
          id="form-city-select"
          value={selectValue}
          onChange={(e) => {
            if (e.target.value !== CUSTOM_CITY_OPTION) {
              onSelectPresetCity(e.target.value);
            }
          }}
          className={INPUT_CLS}
        >
          {customLoc !== undefined && (
            <option value={CUSTOM_CITY_OPTION}>
              {isHi ? `कस्टम: ${customLoc.name}` : `Custom: ${customLoc.name}`}
            </option>
          )}
          {CITY_PRESETS.map((c) => (
            <option key={c.id} value={c.id}>{isHi ? c.nameHi : c.name}</option>
          ))}
        </select>
      </div>
    </div>
  );
});

export const HackChecklist: React.FC<{
  readonly hacks: readonly IAQHackDetail[];
  readonly language: LanguageCode;
  readonly onToggle: (hackId: IAQHackId) => void;
}> = React.memo(function HackChecklist({ hacks, language, onToggle }) {
  const isHi = language === 'hi';
  return (
    <fieldset className="mt-4 border-t border-slate-200 pt-4">
      <legend className="text-sm font-bold text-slate-900">
        {isHi ? 'घर की हवा सुधारने के उपाय (IAQ Hacks)' : 'Active Indoor Air Quality (IAQ) Hacks'}
      </legend>
      <div className="mt-2 space-y-2">
        {hacks.map((hack) => {
          const inputId = `hack-${hack.id}`;
          return (
            <div
              key={hack.id}
              className="flex items-start gap-2.5 rounded-md border border-slate-300 bg-slate-50 p-2.5 hover:bg-slate-100"
            >
              <input
                id={inputId}
                type="checkbox"
                checked={hack.isActive}
                onChange={() => onToggle(hack.id)}
                className="mt-1 h-4 w-4 rounded border-slate-400 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
              />
              <label htmlFor={inputId} className="flex-1 cursor-pointer text-xs text-slate-900">
                <span className="block font-semibold">
                  {isHi ? hack.nameHi : hack.name} · ₹{hack.monthlyCostInr}/mo
                </span>
                <span className="block text-slate-700">
                  {isHi ? (hack.doseImpactLabelHi ?? hack.doseImpactLabel) : hack.doseImpactLabel}
                </span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
});
