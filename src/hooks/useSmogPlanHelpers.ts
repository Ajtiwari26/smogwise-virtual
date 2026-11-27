/**
 * Pure helpers, constants, and race-safe debounced sync effects for useSmogPlan.
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  CustomLocation,
  DominantPollutant,
  FullPlanOutput,
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
  type PlanBriefingApiResponse,
  postPlan,
  postPlanBriefing,
} from '../services/apiClient.js';

/** Debounce interval (ms) for /api/aqi and /api/plan synchronization. */
export const DEBOUNCE_MS = 280;
/** Debounce interval (ms) for /api/plan/briefing GenAI synthesis. */
export const BRIEFING_DEBOUNCE_MS = 450;
/** Default RWA flat count before user adjustment. */
export const DEFAULT_RWA_HOUSEHOLDS = 120;
/** Default RWA adoption rate (45%) before user adjustment. */
export const DEFAULT_RWA_ADOPTION_RATE = 0.45;

/** Structured air-quality sync error code translated dynamically at render time. */
export type AqErrorCode = 'LIVE_AQ_UNAVAILABLE' | 'AQ_SYNC_FAILED';

/** Live or fallback air-quality metadata surfaced to UI banners. */
export interface AqMeta {
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly dominantPollutant: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
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

function resolveAqErrorCode(err: unknown): AqErrorCode {
  if (err instanceof ApiError && err.code === 'LIVE_AQ_UNAVAILABLE') {
    return 'LIVE_AQ_UNAVAILABLE';
  }
  return 'AQ_SYNC_FAILED';
}

/** Formats a structured AQ error code into localized EN/HI banner text. */
export function formatAqErrorCode(
  code: AqErrorCode | undefined,
  lang: LanguageCode,
): string | undefined {
  if (code === undefined) {
    return undefined;
  }
  const isHindi = lang === 'hi';
  if (code === 'LIVE_AQ_UNAVAILABLE') {
    return isHindi
      ? 'इस स्थान के लिए लाइव वायु गुणवत्ता डेटा अस्थायी रूप से उपलब्ध नहीं है। प्रमुख शहर चुनें या पुनः प्रयास करें।'
      : 'Live air quality data is temporarily unavailable for this location. Select a major city preset or retry.';
  }
  return isHindi
    ? 'वायु गुणवत्ता डेटा अपडेट नहीं हो सका; पिछली मान्य योजना सुरक्षित है।'
    : 'Unable to refresh air quality data; showing your last valid plan.';
}

/** Builds a clean CustomLocation object from a geocoding search selection. */
export function buildCustomLocation(item: LocationSearchItem): CustomLocation {
  return {
    name: item.name,
    ...(item.state.trim().length > 0 ? { state: item.state.trim() } : {}),
    lat: item.lat,
    lon: item.lon,
  };
}

/** Returns a copy of profile targeting a preset city with customLocation omitted. */
export function stripCustomLocation(prev: UserProfile, cityId: string): UserProfile {
  return {
    persona: prev.persona,
    cityId,
    language: prev.language,
    householdSize: prev.householdSize,
    hasVulnerableMember: prev.hasVulnerableMember,
    monthlyBudgetInr: prev.monthlyBudgetInr,
    roomVolumeM3: prev.roomVolumeM3,
    commuteMode: prev.commuteMode,
    commuteDistanceKm: prev.commuteDistanceKm,
    cookingFuel: prev.cookingFuel,
    activeHacks: prev.activeHacks,
    ...(prev.rwaHouseholds !== undefined ? { rwaHouseholds: prev.rwaHouseholds } : {}),
    ...(prev.rwaAdoptionRate !== undefined ? { rwaAdoptionRate: prev.rwaAdoptionRate } : {}),
  };
}

/** Handlers passed to useDebouncedAqSync. */
export interface AqSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setLiveAq: Dispatch<SetStateAction<LiveAqOverride | undefined>>;
  readonly setAqMeta: Dispatch<SetStateAction<AqMeta | undefined>>;
  readonly setAqiErrorCode: Dispatch<SetStateAction<AqErrorCode | undefined>>;
  readonly setIsAqSyncing: Dispatch<SetStateAction<boolean>>;
}

/** Debounced race-safe GET /api/aqi synchronization. */
export function useDebouncedAqSync(profile: UserProfile, handlers: AqSyncHandlers): void {
  const { generationRef, setLiveAq, setAqMeta, setAqiErrorCode, setIsAqSyncing } = handlers;
  const { cityId, customLocation } = profile;

  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    setIsAqSyncing(true);
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
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setLiveAq(res.liveAq);
          setAqMeta(buildAqMeta(res));
          setAqiErrorCode(undefined);
          setIsAqSyncing(false);
        })
        .catch((err: unknown) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setAqiErrorCode(resolveAqErrorCode(err));
          setIsAqSyncing(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    cityId,
    customLocation,
    generationRef,
    setLiveAq,
    setAqMeta,
    setAqiErrorCode,
    setIsAqSyncing,
  ]);
}

/** Handlers passed to useDebouncedPlanSync. */
export interface PlanSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setSyncedPlan: Dispatch<SetStateAction<FullPlanOutput | undefined>>;
  readonly setAqiErrorCode: Dispatch<SetStateAction<AqErrorCode | undefined>>;
}

/** Debounced race-safe POST /api/plan synchronization. */
export function useDebouncedPlanSync(profile: UserProfile, handlers: PlanSyncHandlers): void {
  const { generationRef, setSyncedPlan, setAqiErrorCode } = handlers;
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    const timer = setTimeout(() => {
      void postPlan(profile, controller.signal)
        .then((res) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setSyncedPlan(res);
          setAqiErrorCode(undefined);
        })
        .catch((err: unknown) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          if (err instanceof ApiError && err.code === 'LIVE_AQ_UNAVAILABLE') {
            setAqiErrorCode('LIVE_AQ_UNAVAILABLE');
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [profile, generationRef, setSyncedPlan, setAqiErrorCode]);
}

/** Handlers passed to useDebouncedBriefingSync. */
export interface BriefingSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setBriefing: Dispatch<SetStateAction<PlanBriefingApiResponse | undefined>>;
  readonly setIsBriefingLoading: Dispatch<SetStateAction<boolean>>;
}

function buildHouseholdBriefingProfile(profile: UserProfile): UserProfile {
  const householdProfile = { ...profile };
  delete householdProfile.rwaHouseholds;
  delete householdProfile.rwaAdoptionRate;
  return householdProfile;
}

/** Debounced 450ms race-safe POST /api/plan/briefing sync with graceful fallback. */
export function useDebouncedBriefingSync(
  profile: UserProfile,
  handlers: BriefingSyncHandlers,
): void {
  const { generationRef, setBriefing, setIsBriefingLoading } = handlers;
  const briefingProfile = useMemo(() => buildHouseholdBriefingProfile(profile), [profile]);
  const profileRef = useRef(briefingProfile);
  useEffect(() => {
    profileRef.current = briefingProfile;
  }, [briefingProfile]);
  const briefingKey = JSON.stringify(briefingProfile);

  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    setIsBriefingLoading(true);
    const timer = setTimeout(() => {
      void postPlanBriefing(profileRef.current, controller.signal)
        .then((res) => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setBriefing(res);
          setIsBriefingLoading(false);
        })
        .catch((err: unknown) => {
          void err;
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setIsBriefingLoading(false);
        });
    }, BRIEFING_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [briefingKey, generationRef, setBriefing, setIsBriefingLoading]);
}
