/**
 * Pure helpers, constants, and race-safe debounced sync effects for useSmogPlan.
 */

import { useEffect } from 'react';
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

export const DEBOUNCE_MS = 280;
export const BRIEFING_DEBOUNCE_MS = 450;
export const DEFAULT_RWA_HOUSEHOLDS = 120;
export const DEFAULT_RWA_ADOPTION_RATE = 0.45;

/** Live or fallback air-quality metadata surfaced to UI banners. */
export interface AqMeta {
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly dominantPollutant: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
}

/** Normalizes GET /api/aqi metadata into banner state. */
export function buildAqMeta(res: AqiApiResponse): AqMeta {
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

/** Formats localized EN/HI air-quality sync error banners. */
export function formatAqErrorMessage(err: unknown, lang: LanguageCode): string {
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
  const next: UserProfile = { ...prev, cityId };
  delete (next as { customLocation?: CustomLocation }).customLocation;
  return next;
}

export interface AqSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setLiveAq: Dispatch<SetStateAction<LiveAqOverride | undefined>>;
  readonly setAqMeta: Dispatch<SetStateAction<AqMeta | undefined>>;
  readonly setAqiError: Dispatch<SetStateAction<string | undefined>>;
}

/** Debounced race-safe GET /api/aqi synchronization. */
export function useDebouncedAqSync(profile: UserProfile, handlers: AqSyncHandlers): void {
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

export interface PlanSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setSyncedPlan: Dispatch<SetStateAction<FullPlanOutput | undefined>>;
  readonly setIsSyncing: Dispatch<SetStateAction<boolean>>;
  readonly setAqiError: Dispatch<SetStateAction<string | undefined>>;
}

/** Debounced race-safe POST /api/plan synchronization. */
export function useDebouncedPlanSync(profile: UserProfile, handlers: PlanSyncHandlers): void {
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

export interface BriefingSyncHandlers {
  readonly generationRef: MutableRefObject<number>;
  readonly setBriefing: Dispatch<SetStateAction<PlanBriefingApiResponse | undefined>>;
  readonly setIsBriefingLoading: Dispatch<SetStateAction<boolean>>;
}

/** Debounced 450ms race-safe POST /api/plan/briefing sync with graceful fallback. */
export function useDebouncedBriefingSync(
  profile: UserProfile,
  handlers: BriefingSyncHandlers,
): void {
  const { generationRef, setBriefing, setIsBriefingLoading } = handlers;
  useEffect(() => {
    const controller = new AbortController();
    const gen = ++generationRef.current;
    setIsBriefingLoading(true);
    const timer = setTimeout(() => {
      void postPlanBriefing(profile, controller.signal)
        .then((res) => {
          if (gen !== generationRef.current) return;
          setBriefing(res);
          setIsBriefingLoading(false);
        })
        .catch(() => {
          if (gen !== generationRef.current || controller.signal.aborted) return;
          setIsBriefingLoading(false);
        });
    }, BRIEFING_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [profile, generationRef, setBriefing, setIsBriefingLoading]);
}
