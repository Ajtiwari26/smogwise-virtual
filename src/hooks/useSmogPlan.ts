/**
 * React hook managing household profile state, instant Tier 1 plan calculation,
 * race-safe live AQI, /api/plan, and /api/plan/briefing sync, plus <html lang> sync.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { buildRwaScaledPlan, computeFullPlan } from '../domain/impactService.js';
import type {
  DeterministicReport,
  FullPlanOutput,
  IAQHackId,
  LanguageCode,
  LiveAqOverride,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import type { PlanBriefingApiResponse } from '../services/apiClient.js';
import {
  type AqErrorCode,
  type AqMeta,
  buildCustomLocation,
  DEFAULT_RWA_ADOPTION_RATE,
  DEFAULT_RWA_HOUSEHOLDS,
  formatAqErrorCode,
  stripCustomLocation,
  useHouseholdProfile,
  useRemotePlan,
} from './useSmogPlanHelpers.js';

/** Re-exported air-quality metadata type for plan consumers. */
export type { AqMeta } from './useSmogPlanHelpers.js';

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
  readonly householdReport: DeterministicReport;
  readonly snapshotToken: string | undefined;
  readonly syncExternalReport: (
    report: DeterministicReport,
    token?: string,
    requestedToken?: string,
  ) => void;
  readonly presetSelectionRevision: number;
  readonly briefingFailed: boolean;
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

function useProfileActions(
  setProfile: Dispatch<SetStateAction<UserProfile>>,
  revise: Dispatch<SetStateAction<number>>,
) {
  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setProfile((prev) => ({ ...prev, ...patch }));
  }, [setProfile]);

  const toggleHack = useCallback((hackId: IAQHackId) => {
    setProfile((prev) => ({
      ...prev,
      activeHacks: prev.activeHacks.includes(hackId)
        ? prev.activeHacks.filter((id) => id !== hackId)
        : [...prev.activeHacks, hackId],
    }));
  }, [setProfile]);

  const setLanguage = useCallback((language: LanguageCode) => updateProfile({ language }),
    [updateProfile]);
  const selectLocation = useCallback((item: LocationSearchItem) => {
    revise((value) => value + 1);
    updateProfile({ customLocation: buildCustomLocation(item) });
  }, [revise, updateProfile]);
  const selectPresetCity = useCallback((cityId: string) => {
    revise((value) => value + 1);
    setProfile((prev) => stripCustomLocation(prev, cityId));
  }, [revise, setProfile]);
  const applySampleScenario = useCallback((scenario: UserProfile) => {
    revise((value) => value + 1);
    setProfile(scenario);
  }, [revise, setProfile]);
  const updateRwaHouseholds = useCallback((rwaHouseholds: number) =>
    updateProfile({ rwaHouseholds }), [updateProfile]);
  const updateRwaAdoptionRate = useCallback((rwaAdoptionRate: number) =>
    updateProfile({ rwaAdoptionRate }), [updateProfile]);
  return {
    updateProfile, toggleHack, setLanguage, selectLocation, selectPresetCity,
    applySampleScenario, updateRwaHouseholds, updateRwaAdoptionRate,
  };
}

function resolveEffectivePlan(
  basePlan: FullPlanOutput,
  aqiErrorCode: AqErrorCode | undefined,
  isAqSyncing: boolean,
  hasCustomLocation: boolean,
  hasLiveAq: boolean,
): FullPlanOutput {
  if (aqiErrorCode === 'LIVE_AQ_UNAVAILABLE') {
    return { ...basePlan, report: { ...basePlan.report, aqStatus: 'unavailable' } };
  }
  if (isAqSyncing && hasCustomLocation && !hasLiveAq) {
    return { ...basePlan, report: { ...basePlan.report, aqStatus: 'pending' } };
  }
  return basePlan;
}

function matchesObservation(
  briefing: PlanBriefingApiResponse | undefined, report: DeterministicReport,
): boolean {
  return briefing !== undefined && briefing.observationId === report.observationId
    && briefing.aqStatus === report.aqStatus;
}

function matchPlan(local: FullPlanOutput, remote?: FullPlanOutput): FullPlanOutput {
  if (remote === undefined || remote.report.aqStatus !== local.report.aqStatus) {
    return local;
  }
  return remote;
}

/** Provides instant Tier 1 deterministic planning with race-safe backend sync. */
export function useSmogPlan(initialOverrides?: Partial<UserProfile>): UseSmogPlanResult {
  const [profile, setProfile] = useState<UserProfile>(() => ({
    ...DEFAULT_PROFILE,
    ...initialOverrides,
  }));
  const [presetSelectionRevision, revise] = useState(0);
  const householdProfile = useHouseholdProfile(profile);
  const remote = useRemotePlan(householdProfile, presetSelectionRevision);
  const {
    liveAq, aqMeta, snapshotToken, syncExternalReport, syncedPlan, aqiErrorCode,
    isAqSyncing, briefing, isBriefingLoading,
  } = remote;
  const householdPlan = useMemo(
    () => computeFullPlan(householdProfile, liveAq), [householdProfile, liveAq],
  );
  const household = matchPlan(householdPlan, syncedPlan);
  const basePlan = useMemo(
    () => buildRwaScaledPlan(household, profile),
    [household, profile],
  );
  const hasCustom = profile.customLocation !== undefined;
  const hasLiveAq = liveAq !== undefined;
  const plan = useMemo(
    () => resolveEffectivePlan(basePlan, aqiErrorCode, isAqSyncing, hasCustom, hasLiveAq),
    [basePlan, aqiErrorCode, isAqSyncing, hasCustom, hasLiveAq],
  );

  useEffect(() => {
    document.documentElement.lang = profile.language;
  }, [profile.language]);


  const actions = useProfileActions(setProfile, revise);
  const matchingBriefing = matchesObservation(briefing, plan.report);
  return {
    profile,
    plan,
    liveAq,
    aqMeta,
    aqiError: formatAqErrorCode(aqiErrorCode, profile.language),
    isSyncing: isAqSyncing,
    briefing: matchingBriefing ? briefing : undefined,
    briefingFailed: remote.briefingError || (briefing !== undefined && !matchingBriefing),
    householdReport: household.report,
    snapshotToken,
    syncExternalReport,
    presetSelectionRevision,
    isBriefingLoading,
    ...actions,
  };
}
