/**
 * Typed HTTP client wrappers for SmogWise Virtual API endpoints.
 * Supports AbortSignal cancellation, typed ApiError, and zero external dependencies.
 */

import { isPlainRecord } from '../domain/domainUtils.js';
import type {
  FullPlanOutput,
  LocationSearchItem,
  UserProfile,
  WhatIfComparisonResult,
} from '../domain/types.js';
import {
  type AiAskApiResponse,
  ApiError,
  type AqiApiResponse,
  type AuthUser,
  isAiAskPayload,
  isAqiPayload,
  isAuthPayload,
  isBriefingPayload,
  isFullPlanPayload,
  isLocationSearchPayload,
  isLogoutPayload,
  isPrefsGetPayload,
  isPrefsPutPayload,
  isSessionPayload,
  isWhatIfPayload,
  type LocationSearchResponse,
  type PlanBriefingApiResponse,
  type RecordValidator,
} from './apiTypes.js';

/** Re-exported API error class carrying HTTP status and error code. */
export { ApiError } from './apiTypes.js';
/** Re-exported response payload type for POST /api/ai/ask. */
export type { AiAskApiResponse } from './apiTypes.js';
/** Re-exported response payload type for GET /api/aqi. */
export type { AqiApiResponse } from './apiTypes.js';
/** Re-exported authenticated evaluator user profile shape. */
export type { AuthUser } from './apiTypes.js';
/** Re-exported response payload type for POST /api/plan/briefing. */
export type { PlanBriefingApiResponse } from './apiTypes.js';

function mergeJsonHeaders(rawHeaders?: HeadersInit): Record<string, string> {
  const merged: Record<string, string> = { 'Content-Type': 'application/json' };
  if (rawHeaders === undefined) {
    return merged;
  }
  if (rawHeaders instanceof Headers) {
    rawHeaders.forEach((value, key) => {
      merged[key] = value;
    });
    return merged;
  }
  if (Array.isArray(rawHeaders)) {
    for (const [key, value] of rawHeaders) {
      merged[key] = value;
    }
    return merged;
  }
  return { ...merged, ...rawHeaders };
}

async function parseApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `Request failed with status ${String(response.status)}`;
  try {
    const data: unknown = await response.json();
    if (isPlainRecord(data)) {
      if (typeof data['error'] === 'string' && data['error'].length > 0) {
        code = data['error'];
      }
      if (typeof data['message'] === 'string' && data['message'].length > 0) {
        message = data['message'];
      }
    }
  } catch (err: unknown) {
    // Non-JSON or empty error responses fall back to the HTTP status text.
    void err;
    return new ApiError(message, response.status, code);
  }
  return new ApiError(message, response.status, code);
}

const SAME_ORIGIN_CREDENTIALS: RequestCredentials = 'same-origin';

function buildRequestInit(method: string, payload?: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
    ...(signal !== undefined ? { signal } : {}),
  };
}

const responseEtags = new WeakMap<object, string>();

/** Returns the HTTP ETag header recorded for an API JSON response object, if present. */
export function readResponseEtag(payload: object): string | undefined {
  return responseEtags.get(payload);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    throw new ApiError('Expected a JSON response from the server.', response.status, 'INVALID_JSON');
  }
}

async function requestJson<T extends object>(
  url: string,
  init: RequestInit,
  validate: RecordValidator<T>,
  withCredentials = false,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    ...(withCredentials ? { credentials: SAME_ORIGIN_CREDENTIALS } : {}),
    headers: mergeJsonHeaders(init.headers),
  });
  if (!response.ok) {
    throw await parseApiError(response);
  }
  const data = await readJsonResponse(response);
  if (!isPlainRecord(data)) {
    throw new ApiError('Unexpected non-object response from server.', response.status);
  }
  if (!validate(data)) {
    throw new ApiError('Unexpected response shape from server.', response.status);
  }
  const etag = response.headers.get('etag');
  if (etag !== null && etag.length > 0) {
    responseEtags.set(data, etag);
  }
  return data;
}

/** Authenticates user credentials via POST /api/auth/login. */
export async function loginSession(
  email: string,
  password: string,
  signal?: AbortSignal,
): Promise<{ readonly user: AuthUser }> {
  return requestJson('/api/auth/login', buildRequestInit('POST', { email, password }, signal), isAuthPayload, true);
}

/** Checks active session cookie via GET /api/auth/session. */
export async function fetchSession(
  signal?: AbortSignal,
): Promise<{ readonly authenticated: boolean; readonly user: AuthUser | null }> {
  return requestJson('/api/auth/session', buildRequestInit('GET', undefined, signal), isSessionPayload, true);
}

/** Terminates active session via POST /api/auth/logout. */
export async function logoutSession(signal?: AbortSignal): Promise<{ readonly ok: boolean }> {
  return requestJson('/api/auth/logout', buildRequestInit('POST', undefined, signal), isLogoutPayload, true);
}

/** Fetches saved user profile preferences via GET /api/user/preferences. */
export async function fetchUserPreferences(
  signal?: AbortSignal,
): Promise<{ readonly profile: UserProfile | null }> {
  return requestJson('/api/user/preferences', buildRequestInit('GET', undefined, signal), isPrefsGetPayload, true);
}

/** Saves user profile preferences via PUT /api/user/preferences with required If-Match ETag. */
export async function saveUserPreferences(
  profile: UserProfile,
  signal: AbortSignal | undefined,
  expectedEtag: string,
): Promise<{ readonly profile: UserProfile }> {
  if (expectedEtag.trim().length === 0) {
    throw new ApiError('Missing ETag validator for preference update.', 400, 'INVALID_IF_MATCH');
  }
  const baseInit = buildRequestInit('PUT', { profile }, signal);
  const init: RequestInit = { ...baseInit, headers: { 'If-Match': expectedEtag } };
  return requestJson('/api/user/preferences', init, isPrefsPutPayload, true);
}

const degradedSearchArrays = new WeakSet<readonly LocationSearchItem[]>();

/** Returns true when searchLocations results came from offline degraded preset fallback. */
export function isSearchResultDegraded(results: readonly LocationSearchItem[]): boolean {
  return degradedSearchArrays.has(results);
}

/** Searches Indian cities and localities via GET /api/locations/search with degraded flag. */
export async function searchLocationsDetailed(
  query: string,
  signal?: AbortSignal,
): Promise<LocationSearchResponse> {
  const encoded = encodeURIComponent(query);
  return requestJson(
    `/api/locations/search?q=${encoded}`,
    buildRequestInit('GET', undefined, signal),
    isLocationSearchPayload,
  );
}

/** Searches Indian cities and localities via GET /api/locations/search. */
export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<readonly LocationSearchItem[]> {
  const data = await searchLocationsDetailed(query, signal);
  if (data.degraded === true) {
    degradedSearchArrays.add(data.results);
  }
  return data.results;
}

/** Fetches live or preset air-quality data for a city ID. */
export async function fetchAqi(cityId: string, signal?: AbortSignal): Promise<AqiApiResponse> {
  const query = encodeURIComponent(cityId);
  return requestJson(`/api/aqi?city=${query}`, buildRequestInit('GET', undefined, signal), isAqiPayload);
}

/** Fetches live or nearby-preset air-quality data for custom Indian coordinates. */
export async function fetchAqiByCoords(
  lat: number,
  lon: number,
  name?: string,
  state?: string,
  signal?: AbortSignal,
): Promise<AqiApiResponse> {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  if (name !== undefined && name.trim().length > 0) {
    params.set('name', name.trim());
  }
  if (state !== undefined && state.trim().length > 0) {
    params.set('state', state.trim());
  }
  return requestJson(`/api/aqi?${params.toString()}`, buildRequestInit('GET', undefined, signal), isAqiPayload);
}

/** Computes or retrieves the full grounded plan from POST /api/plan. */
export async function postPlan(
  profile: UserProfile,
  signal?: AbortSignal,
  snapshotToken?: string,
): Promise<FullPlanOutput> {
  const payload = snapshotToken === undefined ? profile : { profile, snapshotToken };
  return requestJson('/api/plan', buildRequestInit('POST', payload, signal), isFullPlanPayload);
}

/** Synthesizes a grounded household action briefing via POST /api/plan/briefing. */
export async function postPlanBriefing(
  profile: UserProfile,
  signal?: AbortSignal,
  snapshotToken?: string,
): Promise<PlanBriefingApiResponse> {
  const payload = snapshotToken === undefined ? profile : { profile, snapshotToken };
  return requestJson(
    '/api/plan/briefing',
    buildRequestInit('POST', payload, signal),
    isBriefingPayload,
  );
}

/** Compares baseline and alternative profiles via POST /api/what-if. */
export async function postWhatIf(
  baseline: UserProfile,
  alternative: UserProfile,
  signal?: AbortSignal,
): Promise<WhatIfComparisonResult> {
  return requestJson(
    '/api/what-if',
    buildRequestInit('POST', { baseline, alternative }, signal),
    isWhatIfPayload,
  );
}

/** Sends a grounded question to POST /api/ai/ask. */
export async function postAiAsk(
  question: string,
  profile: UserProfile,
  signal?: AbortSignal,
  snapshotToken?: string,
): Promise<AiAskApiResponse> {
  const payload = snapshotToken === undefined
    ? { question, profile }
    : { question, profile, snapshotToken };
  return requestJson('/api/ai/ask', buildRequestInit('POST', payload, signal), isAiAskPayload);
}
