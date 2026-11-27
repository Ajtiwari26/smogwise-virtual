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
  const data: unknown = await response.json();
  if (!isPlainRecord(data)) {
    throw new ApiError('Unexpected non-object response from server.', response.status);
  }
  if (!validate(data)) {
    throw new ApiError('Unexpected response shape from server.', response.status);
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

/** Saves user profile preferences via PUT /api/user/preferences. */
export async function saveUserPreferences(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<{ readonly profile: UserProfile }> {
  return requestJson('/api/user/preferences', buildRequestInit('PUT', { profile }, signal), isPrefsPutPayload, true);
}

/** Searches Indian cities and localities via GET /api/locations/search. */
export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<readonly LocationSearchItem[]> {
  const encoded = encodeURIComponent(query);
  const data = await requestJson(
    `/api/locations/search?q=${encoded}`,
    buildRequestInit('GET', undefined, signal),
    isLocationSearchPayload,
  );
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
): Promise<FullPlanOutput> {
  return requestJson(
    '/api/plan',
    buildRequestInit('POST', profile, signal),
    isFullPlanPayload,
  );
}

/** Synthesizes a grounded household action briefing via POST /api/plan/briefing. */
export async function postPlanBriefing(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<PlanBriefingApiResponse> {
  return requestJson('/api/plan/briefing', buildRequestInit('POST', profile, signal), isBriefingPayload);
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
): Promise<AiAskApiResponse> {
  return requestJson('/api/ai/ask', buildRequestInit('POST', { question, profile }, signal), isAiAskPayload);
}
