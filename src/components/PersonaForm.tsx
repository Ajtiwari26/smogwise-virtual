/**
 * Accessible household profile form controlling Tier 1 exposure & emissions inputs.
 */

import React, { useCallback, useState } from 'react';
import type {
  IAQHackDetail,
  IAQHackId,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import {
  HackChecklist,
  HouseholdNumericFields,
  LifestyleAndPersonaFields,
  LocationSectionFields,
} from './PersonaFormSections.js';
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
        <LifestyleAndPersonaFields
          profile={profile}
          isHi={isHi}
          onUpdate={handlers.handleManualUpdate}
        />
        <HouseholdNumericFields
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
