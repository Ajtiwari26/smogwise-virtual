/**
 * Accessible household profile form controlling Tier 1 exposure & emissions inputs.
 */

import React, { useCallback, useState } from 'react';
import { SAMPLE_SCENARIOS } from '../domain/sampleScenarios.js';
import type {
  IAQHackDetail,
  IAQHackId,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import { buildCustomLocation } from '../hooks/useSmogPlanHelpers.js';
import {
  HouseholdNumericFields,
  LifestyleAndPersonaFields,
  LocationSectionFields,
} from './PersonaFormSections.js';
import { HackChecklist } from './PersonaHackChecklist.js';
import { ScenarioPresetBar } from './ScenarioPresetBar.js';

/** Props for the household PersonaForm component. */
export interface PersonaFormProps {
  readonly profile: UserProfile;
  readonly presetSelectionRevision?: number;
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

function resolveSyncedScenarioId(
  selectedId: string | undefined,
  profile: UserProfile,
): string | undefined {
  if (selectedId === undefined || profile.customLocation !== undefined) {
    return undefined;
  }
  const matched = SAMPLE_SCENARIOS.find((item) => item.id === selectedId);
  if (
    matched === undefined ||
    matched.profile.cityId !== profile.cityId ||
    matched.profile.persona !== profile.persona
  ) {
    return undefined;
  }
  return selectedId;
}

function useLocationSelectionHandlers(
  props: PersonaFormProps,
  setSelectedScenarioId: React.Dispatch<React.SetStateAction<string | undefined>>,
): Pick<
  FormActionHandlers,
  'handleLocationSelect' | 'handlePresetCitySelect' | 'handleScenarioSelect'
> {
  const { onUpdate, onSelectLocation, onSelectPresetCity, onApplyScenario } = props;

  const handleLocationSelect = useCallback(
    (item: LocationSearchItem) => {
      setSelectedScenarioId(undefined);
      if (onSelectLocation !== undefined) {
        onSelectLocation(item);
        return;
      }
      onUpdate({ customLocation: buildCustomLocation(item) });
    },
    [onSelectLocation, onUpdate, setSelectedScenarioId],
  );

  const handlePresetCitySelect = useCallback(
    (cityId: string) => {
      setSelectedScenarioId(undefined);
      if (onSelectPresetCity !== undefined) {
        onSelectPresetCity(cityId);
      } else {
        onUpdate({ cityId });
      }
    },
    [onSelectPresetCity, onUpdate, setSelectedScenarioId],
  );

  const handleScenarioSelect = useCallback(
    (scenarioId: string, scenarioProfile: UserProfile) => {
      setSelectedScenarioId(scenarioId);
      if (onApplyScenario !== undefined) {
        onApplyScenario(scenarioProfile);
      } else {
        onUpdate(scenarioProfile);
      }
    },
    [onApplyScenario, onUpdate, setSelectedScenarioId],
  );

  return { handleLocationSelect, handlePresetCitySelect, handleScenarioSelect };
}

function usePersonaFormHandlers(props: PersonaFormProps): FormActionHandlers {
  const { profile, onUpdate, onToggleHack } = props;
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | undefined>(undefined);
  const locationHandlers = useLocationSelectionHandlers(props, setSelectedScenarioId);

  const handleManualUpdate = useCallback(
    (patch: Partial<UserProfile>) => {
      setSelectedScenarioId(undefined);
      onUpdate(patch);
    },
    [onUpdate],
  );
  const handleManualToggleHack = useCallback(
    (hackId: IAQHackId) => {
      setSelectedScenarioId(undefined);
      onToggleHack(hackId);
    },
    [onToggleHack],
  );

  return {
    activeScenarioId: resolveSyncedScenarioId(selectedScenarioId, profile),
    handleManualUpdate,
    handleManualToggleHack,
    ...locationHandlers,
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
      <form className="mt-3 space-y-3" noValidate onSubmit={(e) => e.preventDefault()}>
        <LocationSectionFields
          profile={profile}
          isHi={isHi}
          presetSelectionRevision={props.presetSelectionRevision ?? profile.cityId}
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
