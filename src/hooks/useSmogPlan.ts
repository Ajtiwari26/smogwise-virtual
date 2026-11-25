/**
 * React hook managing household profile state, instant Tier 1 plan calculation,
 * race-safe live AQI, /api/plan, and /api/plan/briefing sync, plus <html lang> sync.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { computeFullPlan } from '../domain/impactService.js';
import type {
  FullPlanOutput,
  IAQHackId,
  LanguageCode,
  LiveAqOverride,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import type { PlanBriefingApiResponse } from '../services/apiClient.js';
import {
  type AqMeta,
  buildCustomLocation,
  DEFAULT_RWA_ADOPTION_RATE,
  DEFAULT_RWA_HOUSEHOLDS,
  stripCustomLocation,
  useDebouncedAqSync,
  useDebouncedBriefingSync,
  useDebouncedPlanSync,
} from './useSmogPlanHelpers.js';

export type { AqMeta };

/** Default initial household profile for Delhi winter smog. */
export const DEFAULT_PROFILE: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: true,
  monthlyBudgetInr: 2500,
  roomVolumeM3: 45,
  commuteMode: 'carpool',
  commuteDistanceKm: 15,
  cookingFuel: 'lpg',
  activeHacks: ['window_sealing', 'wet_mopping', 'ventilation_window'],
  rwaHouseholds: DEFAULT_RWA_HOUSEHOLDS,
  rwaAdoptionRate: DEFAULT_RWA_ADOPTION_RATE,
};

/** Return contract for the useSmogPlan hook. */
export interface UseSmogPlanResult {
  readonly profile: UserProfile;
  readonly plan: FullPlanOutput;
  readonly liveAq: LiveAqOverride | undefined;
  readonly aqMeta: AqMeta | undefined;
  readonly aqiError: string | undefined;
  readonly isSyncing: boolean;
  readonly briefing: PlanBriefingApiResponse | undefined;
  readonly isBriefingLoading: boolean;
  readonly updateProfile: (patch: Partial<UserProfile>) => void;
  readonly toggleHack: (hackId: IAQHackId) => void;
  readonly setLanguage: (lang: LanguageCode) => void;
  readonly selectLocation: (item: LocationSearchItem) => void;
  readonly selectPresetCity: (cityId: string) => void;
  readonly applySampleScenario: (scenarioProfile: UserProfile) => void;
  readonly updateRwaHouseholds: (households: number) => void;
  readonly updateRwaAdoptionRate: (rate: number) => void;
}

interface ProfileActions {
  readonly updateProfile: (patch: Partial<UserProfile>) => void;
  readonly toggleHack: (hackId: IAQHackId) => void;
  readonly setLanguage: (lang: LanguageCode) => void;
  readonly selectLocation: (item: LocationSearchItem) => void;
  readonly selectPresetCity: (cityId: string) => void;
  readonly applySampleScenario: (scenarioProfile: UserProfile) => void;
  readonly updateRwaHouseholds: (households: number) => void;
  readonly updateRwaAdoptionRate: (rate: number) => void;
}

interface ActionSetters {
  readonly setProfile: Dispatch<SetStateAction<UserProfile>>;
  readonly setSyncedPlan: Dispatch<SetStateAction<FullPlanOutput | undefined>>;
  readonly setBriefing: Dispatch<SetStateAction<PlanBriefingApiResponse | undefined>>;
  readonly setLiveAq: Dispatch<SetStateAction<LiveAqOverride | undefined>>;
  readonly setAqMeta: Dispatch<SetStateAction<AqMeta | undefined>>;
  readonly setAqiError: Dispatch<SetStateAction<string | undefined>>;
}

function useProfileActions(setters: ActionSetters): ProfileActions {
  const { setProfile, setSyncedPlan, setBriefing, setLiveAq, setAqMeta, setAqiError } = setters;

  const clearRemoteState = useCallback(() => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setLiveAq(undefined);
    setAqMeta(undefined);
    setAqiError(undefined);
  }, [setSyncedPlan, setBriefing, setLiveAq, setAqMeta, setAqiError]);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setProfile((prev) => ({ ...prev, ...patch }));
  }, [setSyncedPlan, setBriefing, setProfile]);

  const toggleHack = useCallback((hackId: IAQHackId) => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setProfile((prev) => {
      const exists = prev.activeHacks.includes(hackId);
      const nextHacks = exists
        ? prev.activeHacks.filter((id) => id !== hackId)
        : [...prev.activeHacks, hackId];
      return { ...prev, activeHacks: nextHacks };
    });
  }, [setSyncedPlan, setBriefing, setProfile]);

  const setLanguage = useCallback((language: LanguageCode) => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setProfile((prev) => ({ ...prev, language }));
  }, [setSyncedPlan, setBriefing, setProfile]);

  const selectLocation = useCallback((item: LocationSearchItem) => {
    clearRemoteState();
    setProfile((prev) => ({ ...prev, customLocation: buildCustomLocation(item) }));
  }, [clearRemoteState, setProfile]);

  const selectPresetCity = useCallback((cityId: string) => {
    clearRemoteState();
    setProfile((prev) => stripCustomLocation(prev, cityId));
  }, [clearRemoteState, setProfile]);

  const applySampleScenario = useCallback((scenarioProfile: UserProfile) => {
    clearRemoteState();
    setProfile({ ...scenarioProfile });
  }, [clearRemoteState, setProfile]);

  const updateRwaHouseholds = useCallback((rwaHouseholds: number) => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setProfile((prev) => ({ ...prev, rwaHouseholds }));
  }, [setSyncedPlan, setBriefing, setProfile]);

  const updateRwaAdoptionRate = useCallback((rwaAdoptionRate: number) => {
    setSyncedPlan(undefined);
    setBriefing(undefined);
    setProfile((prev) => ({ ...prev, rwaAdoptionRate }));
  }, [setSyncedPlan, setBriefing, setProfile]);

  return {
    updateProfile,
    toggleHack,
    setLanguage,
    selectLocation,
    selectPresetCity,
    applySampleScenario,
    updateRwaHouseholds,
    updateRwaAdoptionRate,
  };
}

/** Provides instant Tier 1 deterministic planning with race-safe backend sync. */
export function useSmogPlan(): UseSmogPlanResult {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [liveAq, setLiveAq] = useState<LiveAqOverride | undefined>(undefined);
  const [aqMeta, setAqMeta] = useState<AqMeta | undefined>(undefined);
  const [aqiError, setAqiError] = useState<string | undefined>(undefined);
  const [syncedPlan, setSyncedPlan] = useState<FullPlanOutput | undefined>(undefined);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [briefing, setBriefing] = useState<PlanBriefingApiResponse | undefined>(undefined);
  const [isBriefingLoading, setIsBriefingLoading] = useState<boolean>(false);
  const aqGenRef = useRef<number>(0);
  const planGenRef = useRef<number>(0);
  const briefingGenRef = useRef<number>(0);

  const instantPlan = useMemo(() => computeFullPlan(profile, liveAq), [profile, liveAq]);

  useEffect(() => {
    document.documentElement.lang = profile.language;
  }, [profile.language]);

  useDebouncedAqSync(profile, { generationRef: aqGenRef, setLiveAq, setAqMeta, setAqiError });
  useDebouncedPlanSync(
    profile,
    { generationRef: planGenRef, setSyncedPlan, setIsSyncing, setAqiError },
  );
  useDebouncedBriefingSync(
    profile,
    { generationRef: briefingGenRef, setBriefing, setIsBriefingLoading },
  );

  const actions = useProfileActions({
    setProfile,
    setSyncedPlan,
    setBriefing,
    setLiveAq,
    setAqMeta,
    setAqiError,
  });

  return {
    profile,
    plan: syncedPlan ?? instantPlan,
    liveAq,
    aqMeta,
    aqiError,
    isSyncing,
    briefing,
    isBriefingLoading,
    ...actions,
  };
}
