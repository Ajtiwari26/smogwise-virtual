/**
 * Shared TypeScript request/response interfaces and ApiError for SmogWise API client.
 */

import { isPlainRecord } from '../domain/domainUtils.js';
import { IAQ_HACK_IDS, LANGUAGE_CODES } from '../domain/types.js';
import type {
  AqiBandId,
  AqResolutionStatus,
  CityPreset,
  DeterministicReport,
  DominantPollutant,
  FullPlanOutput,
  LanguageCode,
  LiveAqOverride,
  LocationSearchItem,
  PersonaType,
  UserProfile,
  WhatIfComparisonResult,
} from '../domain/types.js';
import {
  hasNumbers,
  hasOptionalNumbers,
  hasOptionalStrings,
  hasStrings,
  isAqMetadata,
  isAuthUser,
  isIaqHackList,
  isLiveAq,
  isLocationItem,
  isOneOf,
  isProfile,
  isValidCity,
} from './apiValueGuards.js';

/** Authenticated user profile returned by session and login endpoints. */
export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly personaId: PersonaType;
  readonly defaultLang: LanguageCode;
  readonly defaultCityId: string;
}

/** Typed HTTP error preserving status code and structured backend error code. */
export class ApiError extends Error {
  /** HTTP status code returned by the API server. */
  readonly status: number;
  /** Optional machine-readable error code returned in the JSON payload. */
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (code !== undefined) {
      this.code = code;
    }
  }
}

/** Response payload returned by GET /api/aqi. */
export interface AqiApiResponse {
  readonly city: CityPreset;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly cpcbAqi: number;
  readonly aqiBand: AqiBandId;
  readonly dominantPollutant: DominantPollutant;
  readonly fetchedAt: string;
  readonly cached?: boolean;
  readonly observedAt?: string;
  readonly fallbackStationName?: string;
  readonly fallbackDistanceKm?: number;
  readonly liveAq?: LiveAqOverride;
  readonly aqStatus?: AqResolutionStatus;
  readonly observationId?: string;
}

/** Response payload returned by GET /api/locations/search. */
export interface LocationSearchResponse {
  readonly results: readonly LocationSearchItem[];
  readonly degraded?: boolean;
}

/** Response payload returned by POST /api/plan/briefing. */
export interface PlanBriefingApiResponse {
  readonly headline: string;
  readonly summary: string;
  readonly whyActions: readonly string[];
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded';
  readonly citationsUsed: readonly string[];
  readonly modelUsed?: string;
  readonly aqStatus?: AqResolutionStatus;
  readonly observationId?: string;
}

/** Response payload returned by POST /api/ai/ask. */
export interface AiAskApiResponse {
  readonly answer: string;
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded' | 'guard_refusal';
  readonly citationsUsed: readonly string[];
  readonly guardTriggered: boolean;
  readonly modelUsed?: string;
  readonly snapshotToken?: string;
  readonly report: DeterministicReport;
}

/** Runtime response shape guard for parsed JSON object payloads. */
export type RecordValidator<T extends object> = (
  payload: Record<string, unknown>,
) => payload is Record<string, unknown> & T;

/** Validates POST /api/auth/login response envelope. */
export const isAuthPayload: RecordValidator<{ readonly user: AuthUser }> = (
  payload,
): payload is Record<string, unknown> & { readonly user: AuthUser } =>
  isAuthUser(payload['user']);

/** Validates GET /api/auth/session response envelope. */
export const isSessionPayload: RecordValidator<{
  readonly authenticated: boolean;
  readonly user: AuthUser | null;
}> = (
  payload,
): payload is Record<string, unknown> & {
  readonly authenticated: boolean;
  readonly user: AuthUser | null;
} =>
  payload['authenticated'] === true
    ? isAuthUser(payload['user'])
    : payload['authenticated'] === false && payload['user'] === null;

/** Validates POST /api/auth/logout response envelope. */
export const isLogoutPayload: RecordValidator<{ readonly ok: boolean }> = (
  payload,
): payload is Record<string, unknown> & { readonly ok: boolean } =>
  typeof payload['ok'] === 'boolean';

/** Validates GET /api/user/preferences response envelope. */
export const isPrefsGetPayload: RecordValidator<{ readonly profile: UserProfile | null }> = (
  payload,
): payload is Record<string, unknown> & { readonly profile: UserProfile | null } =>
  payload['profile'] === null || isProfile(payload['profile']);

/** Validates PUT /api/user/preferences response envelope. */
export const isPrefsPutPayload: RecordValidator<{ readonly profile: UserProfile }> = (
  payload,
): payload is Record<string, unknown> & { readonly profile: UserProfile } =>
  isProfile(payload['profile']);

/** Validates GET /api/locations/search response envelope. */
export const isLocationSearchPayload: RecordValidator<LocationSearchResponse> = (
  payload,
): payload is Record<string, unknown> & LocationSearchResponse =>
  isRecordArray(payload['results'], isLocationItem) &&
  (payload['degraded'] === undefined || typeof payload['degraded'] === 'boolean');

/** Validates GET /api/aqi response envelope. */
export const isAqiPayload: RecordValidator<AqiApiResponse> = (
  payload,
): payload is Record<string, unknown> & AqiApiResponse =>
  isValidCity(payload['city']) &&
  isAqMetadata(payload) &&
  isAqStatusField(payload['aqStatus']) &&
  isTimestamp(payload['fetchedAt']) &&
  (payload['cached'] === undefined || typeof payload['cached'] === 'boolean') &&
  (payload['liveAq'] === undefined || isLiveAq(payload['liveAq']));

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function isRecordArray(
  value: unknown,
  check: (record: Record<string, unknown>) => boolean,
): boolean {
  return Array.isArray(value) && value.every((item: unknown) => isPlainRecord(item) && check(item));
}

function isCitationRecord(value: unknown): boolean {
  return isPlainRecord(value) && Object.values(value).every((text) => typeof text === 'string');
}

function hasAdvisoryMetadata(payload: Record<string, unknown>): boolean {
  return isOneOf(payload['language'], LANGUAGE_CODES) && isStringArray(payload['citationsUsed']);
}

/** Validates POST /api/plan/briefing response envelope. */
export const isBriefingPayload: RecordValidator<PlanBriefingApiResponse> = (
  payload,
): payload is Record<string, unknown> & PlanBriefingApiResponse =>
  hasStrings(payload, 'headline', 'summary') &&
  isStringArray(payload['whyActions']) &&
  hasOptionalStrings(payload, 'observationId') &&
  isAqStatusField(payload['aqStatus']) &&
  hasAdvisoryMetadata(payload) &&
  (payload['modelUsed'] === undefined || typeof payload['modelUsed'] === 'string') &&
  isOneOf(payload['mode'], ['gemini_interactions', 'offline_grounded']);

/** Validates POST /api/ai/ask response envelope. */
export const isAiAskPayload: RecordValidator<AiAskApiResponse> = (
  payload,
): payload is Record<string, unknown> & AiAskApiResponse =>
  typeof payload['answer'] === 'string' &&
  typeof payload['guardTriggered'] === 'boolean' &&
  hasAdvisoryMetadata(payload) &&
  hasOptionalStrings(payload, 'modelUsed', 'snapshotToken') &&
  isOneOf(payload['mode'], ['gemini_interactions', 'offline_grounded', 'guard_refusal']) &&
  isValidReportEnvelope(payload['report']);

function isValidHourlyPoint(point: Record<string, unknown>): boolean {
  return hasNumbers(point, 'hour', 'outdoorPm25', 'baselineIndoorPm25', 'optimizedIndoorPm25',
    'baselineDoseUg', 'optimizedDoseUg') &&
    typeof point['label'] === 'string' &&
    typeof point['isOptimalVentilation'] === 'boolean';
}

function isValidExposure(value: unknown): boolean {
  return isPlainRecord(value) &&
    hasNumbers(value, 'baselineInhaledUgPerDay', 'optimizedInhaledUgPerDay', 'doseReductionUgPerDay',
      'doseReductionPercent', 'baselineIndoorPm25', 'optimizedIndoorPm25') &&
    typeof value['optimalVentilationWindow'] === 'string' &&
    (value['hourlySeries'] === undefined || isRecordArray(value['hourlySeries'], isValidHourlyPoint));
}

function isValidEmissions(value: unknown): boolean {
  return isPlainRecord(value) &&
    hasNumbers(value, 'co2eAvoidedGramsPerDay', 'pm25AvoidedMgPerDay', 'monthlyNetSavingsInr',
      'communityCo2eAvoidedKgPerMonth', 'communityPm25AvoidedGramsPerMonth');
}

function isAqStatusField(value: unknown): boolean {
  return value === undefined || isOneOf(value, ['live', 'nearby_proxy', 'pending', 'unavailable']);
}

function isValidReportEnvelope(value: unknown): boolean {
  return isPlainRecord(value) &&
    isValidCity(value['city']) &&
    isValidExposure(value['exposure']) &&
    isValidEmissions(value['emissions']) &&
    isCitationRecord(value['citations']) &&
    isAqMetadata(value) &&
    isAqStatusField(value['aqStatus']) &&
    hasOptionalNumbers(value, 'livePm10', 'liveNo2') &&
    isIaqHackList(value['recommendedHacks']);
}

function isRoutineBlock(block: Record<string, unknown>): boolean {
  return hasStrings(block, 'id', 'timeRange', 'title', 'description') &&
    hasNumbers(block, 'outdoorPm25', 'indoorPm25') &&
    isOneOf(block['category'], ['commute', 'ventilation', 'cooking', 'sleep', 'protection']);
}

function isIaqHack(hack: Record<string, unknown>): boolean {
  return isOneOf(hack['id'], IAQ_HACK_IDS) &&
    hasStrings(hack, 'name', 'nameHi', 'instructions', 'instructionsHi', 'doseImpactLabel') &&
    (hack['doseImpactLabelHi'] === undefined || typeof hack['doseImpactLabelHi'] === 'string') &&
    Number.isFinite(hack['monthlyCostInr']) &&
    typeof hack['withinBudget'] === 'boolean' &&
    typeof hack['isActive'] === 'boolean';
}

/** Validates POST /api/plan FullPlanOutput response structure. */
export const isFullPlanPayload: RecordValidator<FullPlanOutput> = (
  payload,
): payload is Record<string, unknown> & FullPlanOutput =>
  isValidReportEnvelope(payload['report']) &&
  isRecordArray(payload['routine'], isRoutineBlock) &&
  isRecordArray(payload['iaqHacks'], isIaqHack) &&
  hasStrings(payload, 'localizedSummary', 'rwaNotice') &&
  hasOptionalStrings(payload, 'snapshotToken') &&
  isCitationRecord(payload['citations']);

function isValidDelta(value: unknown): boolean {
  return isPlainRecord(value) &&
    hasNumbers(value, 'doseReductionUgPerDay', 'co2eAvoidedGramsPerDay', 'pm25AvoidedMgPerDay',
      'monthlyNetSavingsInr');
}

/** Validates POST /api/what-if WhatIfComparisonResult response structure. */
export const isWhatIfPayload: RecordValidator<WhatIfComparisonResult> = (
  payload,
): payload is Record<string, unknown> & WhatIfComparisonResult =>
  isValidReportEnvelope(payload['baseline']) &&
  isValidReportEnvelope(payload['alternative']) &&
  isValidDelta(payload['delta']) &&
  isPlainRecord(payload['explanation']) &&
  hasStrings(payload['explanation'], 'en', 'hi') &&
  isCitationRecord(payload['citations']);
