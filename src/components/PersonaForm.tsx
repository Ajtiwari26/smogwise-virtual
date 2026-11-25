import React, { useCallback, useState } from 'react';
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
import { ScenarioPresetBar } from './ScenarioPresetBar.js';

/** Props for the household PersonaForm component. */
export interface PersonaFormProps {
  readonly profile: UserProfile;
  readonly iaqHacks: readonly IAQHackDetail[];
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
  readonly onToggleHack: (hackId: IAQHackId) => void;
  readonly onSelectLocation?: (item: LocationSearchItem) => void;
  readonly onSelectPresetCity?: (cityId: string) => void;
  readonly onApplyScenario?: (scenarioProfile: UserProfile) => void;
}

interface BilingualOption<T extends string> {
  readonly id: T;
  readonly en: string;
  readonly hi: string;
}

const PERSONA_OPTIONS: readonly BilingualOption<PersonaType>[] = [
  { id: 'young_family', en: 'Young Family', hi: 'युवा परिवार' },
  {
    id: 'sensitive_household',
    en: 'Sensitive Household (Elderly/Asthma)',
    hi: 'संवेदनशील परिवार (बुजुर्ग/अस्थमा)',
  },
  { id: 'rwa_coordinator', en: 'RWA / Community Coordinator', hi: 'RWA / समुदाय समन्वयक' },
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

const INPUT_CLS =
  'mt-1 w-full rounded-md border border-slate-400 bg-white px-2.5 py-1.5 ' +
  'text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700';

function parseBoundedInt(raw: string, fallback: number, min: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.round(n)) : fallback;
}

const HackChecklist: React.FC<{
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
                <span className="block text-slate-700">{hack.doseImpactLabel}</span>
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
});

const HouseholdNumericFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function HouseholdNumericFields({ profile, isHi, onUpdate }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="household-size" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'सदस्य संख्या' : 'Household Size'}
          </label>
          <input
            id="household-size"
            type="number"
            min={1}
            max={12}
            value={profile.householdSize}
            onChange={(e) => onUpdate({ householdSize: parseBoundedInt(e.target.value, 1, 1) })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label htmlFor="monthly-budget" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'मासिक बजट (₹)' : 'Monthly Budget (₹)'}
          </label>
          <input
            id="monthly-budget"
            type="number"
            min={0}
            max={50000}
            step={250}
            value={profile.monthlyBudgetInr}
            onChange={(e) => onUpdate({ monthlyBudgetInr: parseBoundedInt(e.target.value, 0, 0) })}
            className={INPUT_CLS}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="room-volume" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'कमरे का आयतन (m³)' : 'Room Volume (m³)'}
          </label>
          <input
            id="room-volume"
            type="number"
            min={15}
            max={200}
            value={profile.roomVolumeM3}
            onChange={(e) => onUpdate({ roomVolumeM3: parseBoundedInt(e.target.value, 45, 15) })}
            className={INPUT_CLS}
          />
        </div>
        <div>
          <label htmlFor="commute-km" className="block text-xs font-semibold text-slate-800">
            {isHi ? 'दैनिक यात्रा (km)' : 'Commute (km/day)'}
          </label>
          <input
            id="commute-km"
            type="number"
            min={0}
            max={150}
            value={profile.commuteDistanceKm}
            onChange={(e) =>
              onUpdate({ commuteDistanceKm: parseBoundedInt(e.target.value, 0, 0) })
            }
            className={INPUT_CLS}
          />
        </div>
      </div>
    </>
  );
});

const LifestyleSelectFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function LifestyleSelectFields({ profile, isHi, onUpdate }) {
  return (
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
            <option key={opt.id} value={opt.id}>
              {isHi ? opt.hi : opt.en}
            </option>
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
            <option key={opt.id} value={opt.id}>
              {isHi ? opt.hi : opt.en}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

const LocationSectionFields: React.FC<{
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
  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <LocationSearchCombobox
        language={profile.language}
        customLocation={profile.customLocation}
        onSelectLocation={onSelectLocation}
      />
      <div>
        <label htmlFor="form-city-select" className="block text-xs font-semibold text-slate-800">
          {isHi ? 'या प्रमुख शहर प्रीसेट चुनें' : 'Or Select Major City Preset'}
        </label>
        <select
          id="form-city-select"
          value={profile.cityId}
          onChange={(e) => onSelectPresetCity(e.target.value)}
          className={INPUT_CLS}
        >
          {CITY_PRESETS.map((c) => (
            <option key={c.id} value={c.id}>
              {isHi ? c.nameHi : c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
});

const PersonaAndVulnerableFields: React.FC<{
  readonly profile: UserProfile;
  readonly isHi: boolean;
  readonly onUpdate: (patch: Partial<UserProfile>) => void;
}> = React.memo(function PersonaAndVulnerableFields({ profile, isHi, onUpdate }) {
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
            <option key={opt.id} value={opt.id}>
              {isHi ? opt.hi : opt.en}
            </option>
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
    </>
  );
});

interface FormActionHandlers {
  readonly activeScenarioId: string | undefined;
  readonly handleManualUpdate: (patch: Partial<UserProfile>) => void;
  readonly handleManualToggleHack: (hackId: IAQHackId) => void;
  readonly handleLocationSelect: (item: LocationSearchItem) => void;
  readonly handlePresetCitySelect: (cityId: string) => void;
  readonly handleScenarioSelect: (scenarioId: string, scenarioProfile: UserProfile) => void;
}

function usePersonaFormHandlers(props: PersonaFormProps): FormActionHandlers {
  const { onUpdate, onToggleHack, onSelectLocation, onSelectPresetCity, onApplyScenario } = props;
  const [activeScenarioId, setActiveScenarioId] = useState<string | undefined>(undefined);

  const handleManualUpdate = useCallback(
    (patch: Partial<UserProfile>) => {
      setActiveScenarioId(undefined);
      onUpdate(patch);
    },
    [onUpdate],
  );
  const handleManualToggleHack = useCallback(
    (hackId: IAQHackId) => {
      setActiveScenarioId(undefined);
      onToggleHack(hackId);
    },
    [onToggleHack],
  );
  const handleLocationSelect = useCallback(
    (item: LocationSearchItem) => {
      setActiveScenarioId(undefined);
      if (onSelectLocation !== undefined) {
        onSelectLocation(item);
        return;
      }
      onUpdate({
        customLocation: {
          name: item.name,
          ...(item.state.trim().length > 0 ? { state: item.state.trim() } : {}),
          lat: item.lat,
          lon: item.lon,
        },
      });
    },
    [onSelectLocation, onUpdate],
  );
  const handlePresetCitySelect = useCallback(
    (cityId: string) => {
      setActiveScenarioId(undefined);
      if (onSelectPresetCity !== undefined) {
        onSelectPresetCity(cityId);
      } else {
        onUpdate({ cityId });
      }
    },
    [onSelectPresetCity, onUpdate],
  );
  const handleScenarioSelect = useCallback(
    (scenarioId: string, scenarioProfile: UserProfile) => {
      setActiveScenarioId(scenarioId);
      if (onApplyScenario !== undefined) {
        onApplyScenario(scenarioProfile);
      } else {
        onUpdate(scenarioProfile);
      }
    },
    [onApplyScenario, onUpdate],
  );
  return {
    activeScenarioId,
    handleManualUpdate,
    handleManualToggleHack,
    handleLocationSelect,
    handlePresetCitySelect,
    handleScenarioSelect,
  };
}

/** Accessible household profile form controlling Tier 1 exposure & emissions inputs. */
export const PersonaForm: React.FC<PersonaFormProps> = React.memo(function PersonaForm(props) {
  const { profile, iaqHacks } = props;
  const isHi = profile.language === 'hi';
  const handlers = usePersonaFormHandlers(props);

  return (
    <section
      aria-labelledby="persona-form-heading"
      className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
    >
      <h2 id="persona-form-heading" className="text-base font-bold text-slate-900">
        {isHi ? 'परिवार और घर का विवरण' : 'Household & Exposure Profile'}
      </h2>
      <div className="mt-3">
        <ScenarioPresetBar
          language={profile.language}
          activeScenarioId={handlers.activeScenarioId}
          onSelectScenario={handlers.handleScenarioSelect}
        />
      </div>
      <form className="mt-3 space-y-3" onSubmit={(e) => e.preventDefault()}>
        <LocationSectionFields
          profile={profile}
          isHi={isHi}
          onSelectLocation={handlers.handleLocationSelect}
          onSelectPresetCity={handlers.handlePresetCitySelect}
        />
        <PersonaAndVulnerableFields
          profile={profile}
          isHi={isHi}
          onUpdate={handlers.handleManualUpdate}
        />
        <HouseholdNumericFields
          profile={profile}
          isHi={isHi}
          onUpdate={handlers.handleManualUpdate}
        />
        <LifestyleSelectFields
          profile={profile}
          isHi={isHi}
          onUpdate={handlers.handleManualUpdate}
        />
        <HackChecklist
          hacks={iaqHacks}
          language={profile.language}
          onToggle={handlers.handleManualToggleHack}
        />
      </form>
    </section>
  );
});
