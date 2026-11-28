/**
 * Pure air-quality metadata formatters, constants, and location helpers for useSmogPlan.
 */

import type {
  CustomLocation,
  DeterministicReport,
  DominantPollutant,
  LanguageCode,
  LocationSearchItem,
  UserProfile,
} from '../domain/types.js';
import { ApiError } from '../services/apiClient.js';

/** Debounce interval (ms) for /api/plan synchronization. */
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
  readonly observationId?: string;
  readonly dominantPollutant: DominantPollutant;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
}

/** Extracts display AQ metadata from a settled DeterministicReport. */
export function readAqMetaFromReport(report: DeterministicReport | undefined): AqMeta | undefined {
  if (report === undefined || report.aqStatus === 'unavailable') return undefined;
  return {
    dataSource: report.dataSource,
    cpcbAqi: report.cpcbAqi,
    ...(report.observationId !== undefined ? { observationId: report.observationId } : {}),
    dominantPollutant: report.dominantPollutant,
    ...(report.observedAt !== undefined ? { observedAt: report.observedAt } : {}),
    ...(report.fallbackStationName !== undefined
      ? { fallbackStationName: report.fallbackStationName }
      : {}),
    ...(report.fallbackDistanceKm !== undefined
      ? { fallbackDistanceKm: report.fallbackDistanceKm }
      : {}),
  };
}

/** Maps a sync failure to a structured AqErrorCode. */
export function resolveAqErrorCode(err: unknown): AqErrorCode {
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
  if (code === undefined) return undefined;
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

/** Builds a deterministic location key from preset or custom coordinates. */
export function buildLocationKey(profile: UserProfile): string {
  const custom = profile.customLocation;
  if (custom === undefined) return profile.cityId;
  return JSON.stringify([profile.cityId, custom.lat, custom.lon, custom.name, custom.state ?? '']);
}

/** Tracked observation identity for monotonic snapshot reconciliation. */
export interface TrackedSnapshotMeta {
  readonly key?: string;
  readonly revision?: number;
  readonly errorCode?: AqErrorCode;
  readonly observationId?: string;
  readonly observedAt?: string;
  readonly token?: string;
}

/** Returns the tracked snapshot when locationKey and revision still match. */
export function readActiveLoc<T extends TrackedSnapshotMeta>(
  cur: T | undefined,
  locationKey: string,
  revision: number,
): T | undefined {
  return cur !== undefined && cur.key === locationKey && cur.revision === revision
    ? cur : undefined;
}

/** Builds a normalized location snapshot tracking entry for useSmogPlan. */
export function buildTrackedLocRef(
  key: string,
  revision: number,
  report: DeterministicReport,
  token?: string,
): TrackedSnapshotMeta & { readonly key: string; readonly revision: number } {
  return {
    key,
    revision,
    ...(report.observationId !== undefined ? { observationId: report.observationId } : {}),
    ...(report.observedAt !== undefined ? { observedAt: report.observedAt } : {}),
    ...(token !== undefined ? { token } : {}),
  };
}

function parseObservedMs(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

function isOlderTimestamp(curTs: number | undefined, nextTs: number | undefined): boolean {
  return curTs !== undefined && nextTs !== undefined && nextTs < curTs;
}

function isTokenRaceStale(
  current: TrackedSnapshotMeta | undefined,
  requestedToken: string | undefined,
  curTs: number | undefined,
  nextTs: number | undefined,
): boolean {
  if (current === undefined || requestedToken === undefined) return false;
  if (current.token === undefined || requestedToken === current.token) return false;
  return curTs === undefined || nextTs === undefined || nextTs <= curTs;
}

/** Prevents older out-of-order responses from rolling back fresher workspace snapshots. */
export function shouldAcceptExternalSnapshot(
  current: TrackedSnapshotMeta | undefined,
  nextReport: DeterministicReport,
  nextToken: string | undefined,
  requestedToken: string | undefined,
): boolean {
  if (nextReport.aqStatus === 'unavailable') return false;
  const curTs = parseObservedMs(current?.observedAt);
  const nextTs = parseObservedMs(nextReport.observedAt);
  if (isOlderTimestamp(curTs, nextTs)) return false;
  if (isTokenRaceStale(current, requestedToken, curTs, nextTs)) return false;
  if (current?.observationId !== undefined && current.observationId === nextReport.observationId) {
    return nextToken !== undefined && nextToken !== current.token;
  }
  return true;
}
