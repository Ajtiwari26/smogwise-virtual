/**
 * React hook managing household profile state, instant Tier 1 plan calculation,
 * race-safe live AQI & /api/plan sync (preset or customLocation), and <html lang> sync.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeFullPlan } from '../domain/impactService.js';
import type {
  CustomLocation,
  DominantPollutant,
  FullPlanOutput,
  IAQHackId,
  LanguageCode,
  LiveAqOverride,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import {
  ApiError,
  type AqiApiResponse,
  fetchAqi,
  fetchAqiByCoords,
  postPlan,
} from '../services/apiClient.js';

const DEBOUNCE_MS = 280;

/** Live or fallback air-quality metadata surfaced to UI banners. */
export interface AqMeta {
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly dominantPollutant: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
}

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
  rwaHouseholds: 120,
  rwaAdoptionRate: 0.45,
};

/** Return contract for the useSmogPlan hook. */
export interface UseSmogPlanResult {
  readonly profile: UserProfile;
  readonly plan: FullPlanOutput;
  readonly liveAq: LiveAqOverride | undefined;
  readonly aqMeta: AqMeta | undefined;
  readonly aqiError: string | undefined;
  readonly isSyncing: boolean;
  readonly updateProfile: (patch: Partial<UserProfile>) => void;
  readonly toggleHack: (hackId: IAQHackId) => void;
  readonly setLanguage: (lang: LanguageCode) => void;
  readonly selectLocation: (item: LocationSearchItem) => void;
  readonly selectPresetCity: (cityId: string) => void;
  readonly applySampleScenario: (scenarioProfile: UserProfile) => void;
}

function buildAqMeta(res: AqiApiResponse): AqMeta {
  return {
    dataSource: res.dataSource,
    cpcbAqi: res.cpcbAqi,
    dominantPollutant: res.dominantPollutant,
    ...(res.observedAt !== undefined ? { observedAt: res.observedAt } : {}),
    ...(res.fallbackStationName !== undefined
      ? { fallbackStationName: res.fallbackStationName }
      : {}),
    ...(res.fallbackDistanceKm !== undefined
      ? { fallbackDistanceKm: res.fallbackDistanceKm }
      : {}),
  };
}

function formatAqErrorMessage(err: unknown, lang: LanguageCode): string {
  const isHindi = lang === 'hi';
  if (err instanceof ApiError && err.code === 'LIVE_AQ_UNAVAILABLE') {
    return isHindi
      ? 'इस स्थान के लिए लाइव वायु गुणवत्ता डेटा अस्थायी रूप से उपलब्ध नहीं है। प्रमुख शहर चुनें या पुनः प्रयास करें।'
      : 'Live air quality data is temporarily unavailable for this location. Select a major city preset or retry.';
  }
  return isHindi
    ? 'वायु गुणवत्ता डेटा अपडेट नहीं हो सका; पिछली मान्य योजना सुरक्षित है।'
    : 'Unable to refresh air quality data; showing your last valid plan.';
}

function buildCustomLocation(item: LocationSearchItem): CustomLocation {
  return {
    name: item.name,
    ...(item.state.trim().length > 0 ? { state: item.state.trim() } : {}),
    lat: item.lat,
    lon: item.lon,
  };
}

function stripCustomLocation(prev: UserProfile, cityId: string): UserProfile {
  const next: UserProfile = { ...prev, cityId };
  delete (next as { customLocation?: CustomLocation }).customLocation;
  return next;
}

interface AqSyncHandlers {
  readonly generationRef: React.MutableRefObject<number>;
  readonly setLiveAq: React.Dispatch<React.SetStateAction<LiveAqOverride | undefined>>;
  readonly setAqMeta: React.Dispatch<React.SetStateAction<AqMeta | undefined>>;
  readonly setAqiError: React.Dispatch<React.SetStateAction<string | undefined>>;
}

function useDebouncedAqSync(profile: UserProfile, handlers: AqSyncHandlers): void {
  const { generationRef, setLiveAq, setAqMeta, setAqiError } = handlers;
  const { cityId, customLocation, language } = profile;
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    const timer = setTimeout(() => {
      const req = customLocation !== undefined
        ? fetchAqiByCoords(
          customLocation.lat,
          customLocation.lon,
          customLocation.name,
          customLocation.state,
          controller.signal,
        )
        : fetchAqi(cityId, controller.signal);
      void req
        .then((res) => {
          if (gen !== generationRef.current) return;
          setLiveAq(res.liveAq);
          setAqMeta(buildAqMeta(res));
          setAqiError(undefined);
        })
        .catch((err: unknown) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setAqiError(formatAqErrorMessage(err, language));
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cityId, customLocation, language, generationRef, setLiveAq, setAqMeta, setAqiError]);
}

interface PlanSyncHandlers {
  readonly generationRef: React.MutableRefObject<number>;
  readonly setSyncedPlan: React.Dispatch<React.SetStateAction<FullPlanOutput | undefined>>;
  readonly setIsSyncing: React.Dispatch<React.SetStateAction<boolean>>;
  readonly setAqiError: React.Dispatch<React.SetStateAction<string | undefined>>;
}

function useDebouncedPlanSync(profile: UserProfile, handlers: PlanSyncHandlers): void {
  const { generationRef, setSyncedPlan, setIsSyncing, setAqiError } = handlers;
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    setIsSyncing(true);
    const timer = setTimeout(() => {
      void postPlan(profile, controller.signal)
        .then((res) => {
          if (gen !== generationRef.current) return;
          setSyncedPlan(res);
          setAqiError(undefined);
          setIsSyncing(false);
        })
        .catch((err: unknown) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setIsSyncing(false);
          if (err instanceof ApiError && err.code === 'LIVE_AQ_UNAVAILABLE') {
            setAqiError(formatAqErrorMessage(err, profile.language));
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [profile, generationRef, setSyncedPlan, setIsSyncing, setAqiError]);
}

interface ProfileActions {
  readonly updateProfile: (patch: Partial<UserProfile>) => void;
  readonly toggleHack: (hackId: IAQHackId) => void;
  readonly setLanguage: (lang: LanguageCode) => void;
  readonly selectLocation: (item: LocationSearchItem) => void;
  readonly selectPresetCity: (cityId: string) => void;
  readonly applySampleScenario: (scenarioProfile: UserProfile) => void;
}

function useProfileActions(
  setProfile: React.Dispatch<React.SetStateAction<UserProfile>>,
  setSyncedPlan: React.Dispatch<React.SetStateAction<FullPlanOutput | undefined>>,
  setLiveAq: React.Dispatch<React.SetStateAction<LiveAqOverride | undefined>>,
  setAqMeta: React.Dispatch<React.SetStateAction<AqMeta | undefined>>,
  setAqiError: React.Dispatch<React.SetStateAction<string | undefined>>,
): ProfileActions {
  const clearRemoteAqState = useCallback(() => {
    setSyncedPlan(undefined);
    setLiveAq(undefined);
    setAqMeta(undefined);
    setAqiError(undefined);
  }, [setSyncedPlan, setLiveAq, setAqMeta, setAqiError]);

  const updateProfile = useCallback((patch: Partial<UserProfile>) => {
    setSyncedPlan(undefined);
    setProfile((prev) => ({ ...prev, ...patch }));
  }, [setSyncedPlan, setProfile]);

  const toggleHack = useCallback((hackId: IAQHackId) => {
    setSyncedPlan(undefined);
    setProfile((prev) => {
      const exists = prev.activeHacks.includes(hackId);
      const nextHacks = exists
        ? prev.activeHacks.filter((id) => id !== hackId)
        : [...prev.activeHacks, hackId];
      return { ...prev, activeHacks: nextHacks };
    });
  }, [setSyncedPlan, setProfile]);

  const setLanguage = useCallback((language: LanguageCode) => {
    setSyncedPlan(undefined);
    setProfile((prev) => ({ ...prev, language }));
  }, [setSyncedPlan, setProfile]);

  const selectLocation = useCallback((item: LocationSearchItem) => {
    clearRemoteAqState();
    setProfile((prev) => ({ ...prev, customLocation: buildCustomLocation(item) }));
  }, [clearRemoteAqState, setProfile]);

  const selectPresetCity = useCallback((cityId: string) => {
    clearRemoteAqState();
    setProfile((prev) => stripCustomLocation(prev, cityId));
  }, [clearRemoteAqState, setProfile]);

  const applySampleScenario = useCallback((scenarioProfile: UserProfile) => {
    clearRemoteAqState();
    setProfile({ ...scenarioProfile });
  }, [clearRemoteAqState, setProfile]);

  return {
    updateProfile,
    toggleHack,
    setLanguage,
    selectLocation,
    selectPresetCity,
    applySampleScenario,
  };
}

/**
 * Provides instant Tier 1 deterministic planning with race-safe backend sync.
 */
export function useSmogPlan(): UseSmogPlanResult {
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [liveAq, setLiveAq] = useState<LiveAqOverride | undefined>(undefined);
  const [aqMeta, setAqMeta] = useState<AqMeta | undefined>(undefined);
  const [aqiError, setAqiError] = useState<string | undefined>(undefined);
  const [syncedPlan, setSyncedPlan] = useState<FullPlanOutput | undefined>(undefined);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const aqGenRef = useRef<number>(0);
  const planGenRef = useRef<number>(0);

  const instantPlan = useMemo(() => computeFullPlan(profile, liveAq), [profile, liveAq]);

  useEffect(() => {
    document.documentElement.lang = profile.language;
  }, [profile.language]);

  useDebouncedAqSync(profile, { generationRef: aqGenRef, setLiveAq, setAqMeta, setAqiError });
  useDebouncedPlanSync(
    profile,
    { generationRef: planGenRef, setSyncedPlan, setIsSyncing, setAqiError },
  );

  const actions = useProfileActions(
    setProfile,
    setSyncedPlan,
    setLiveAq,
    setAqMeta,
    setAqiError,
  );

  return {
    profile,
    plan: syncedPlan ?? instantPlan,
    liveAq,
    aqMeta,
    aqiError,
    isSyncing,
    ...actions,
  };
}
