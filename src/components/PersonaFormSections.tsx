/**
 * Accessible sub-sections for PersonaForm with semantic fieldsets and range validation hints.
 */

import React from 'react';
import { CITY_PRESETS } from '../domain/cityPresets.js';
import type {
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import { LocationSearchCombobox } from './LocationSearchCombobox.js';
import {
  COMMUTE_OPTIONS,
  FUEL_OPTIONS,
  INPUT_CLS,
  PERSONA_OPTIONS,
  SelectField,
} from './PersonaSelectFields.js';

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return fallback;
  }
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
      <span
        id={hintId}
        className={`mt-0.5 block text-xs ${isOutOfRange ? 'font-semibold text-red-800' : 'text-slate-700'}`}
      >
        {hint}
      </span>
    </div>
  );
}

/** Grid of household size, monthly budget, room volume, and daily commute numeric fields. */
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

/** Persona selector, vulnerable member checkbox, commute mode, and cooking fuel selectors. */
export const LifestyleAndPersonaFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function LifestyleAndPersonaFields({ profile, isHi, onUpdate }) {
  return (
    <>
      <SelectField
        id="persona-select"
        label={isHi ? 'परिवार का प्रकार' : 'Household Persona'}
        value={profile.persona}
        options={PERSONA_OPTIONS}
        isHi={isHi}
        onSelect={(persona) => onUpdate({ persona })}
      />
      <div className="flex items-center gap-2">
        <input
          id="vulnerable-member"
          type="checkbox"
          checked={profile.hasVulnerableMember}
          onChange={(e) => onUpdate({ hasVulnerableMember: e.target.checked })}
          className="h-4 w-4 rounded border-slate-500 text-teal-700 focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <label htmlFor="vulnerable-member" className="text-xs font-semibold text-slate-800">
          {isHi
            ? 'घर में संवेदनशील सदस्य (बच्चे/बुजुर्ग/अस्थमा)'
            : 'Vulnerable member (child / elderly / asthma)'}
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <SelectField
          id="commute-mode"
          label={isHi ? 'यात्रा का माध्यम' : 'Commute Mode'}
          value={profile.commuteMode}
          options={COMMUTE_OPTIONS}
          isHi={isHi}
          onSelect={(commuteMode) => onUpdate({ commuteMode })}
        />
        <SelectField
          id="cooking-fuel"
          label={isHi ? 'रसोई ईंधन' : 'Cooking Fuel'}
          value={profile.cookingFuel}
          options={FUEL_OPTIONS}
          isHi={isHi}
          onSelect={(cookingFuel) => onUpdate({ cookingFuel })}
        />
      </div>
    </>
  );
});

const CUSTOM_CITY_OPTION = '__custom_location__';

/** Pan-India location combobox paired with major winter smog preset city selector. */
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
    <div className="space-y-3 rounded-md border border-slate-300 bg-slate-50 p-3">
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
