/**
 * Typed HTTP client wrappers for SmogWise Virtual API endpoints.
 * Supports AbortSignal cancellation, typed ApiError, and zero external dependencies.
 */

import type {
  AqiBandId,
  CityPreset,
  DeterministicReport,
  DominantPollutant,
  FullPlanOutput,
  LanguageCode,
  LiveAqOverride,
  LocationSearchItem,
  UserProfile,
  WhatIfComparisonResult,
} from '../domain/types.js';

/** Typed HTTP error preserving status code and structured backend error code. */
export class ApiError extends Error {
  readonly status: number;
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
}

/** Response payload returned by GET /api/locations/search. */
interface LocationSearchResponse {
  readonly results: readonly LocationSearchItem[];
}

/** Response payload returned by POST /api/plan/briefing. */
export interface PlanBriefingApiResponse {
  readonly headline: string;
  readonly summary: string;
  readonly whyActions: readonly string[];
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded';
  readonly citationsUsed: readonly string[];
}

/** Response payload returned by POST /api/ai/ask. */
export interface AiAskApiResponse {
  readonly answer: string;
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded' | 'guard_refusal';
  readonly citationsUsed: readonly string[];
  readonly guardTriggered: boolean;
  readonly report: DeterministicReport;
}

interface ErrorPayload {
  readonly error?: unknown;
  readonly message?: unknown;
}

async function parseApiError(response: Response): Promise<ApiError> {
  let code: string | undefined;
  let message = `Request failed with status ${String(response.status)}`;
  try {
    const data = (await response.json()) as ErrorPayload;
    if (typeof data.error === 'string' && data.error.length > 0) {
      code = data.error;
    }
    if (typeof data.message === 'string' && data.message.length > 0) {
      message = data.message;
    }
  } catch {
    // Keep fallback status message when error body is non-JSON
  }
  return new ApiError(message, response.status, code);
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw await parseApiError(response);
  }
  return (await response.json()) as T;
}

/** Searches Indian cities and localities via GET /api/locations/search. */
export async function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<readonly LocationSearchItem[]> {
  const encoded = encodeURIComponent(query);
  const data = await requestJson<LocationSearchResponse>(`/api/locations/search?q=${encoded}`, {
    method: 'GET',
    ...(signal !== undefined ? { signal } : {}),
  });
  return data.results;
}

/** Fetches live or preset air-quality data for a city ID. */
export async function fetchAqi(cityId: string, signal?: AbortSignal): Promise<AqiApiResponse> {
  const query = encodeURIComponent(cityId);
  return requestJson<AqiApiResponse>(`/api/aqi?city=${query}`, {
    method: 'GET',
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Fetches live or nearby-preset air-quality data for custom Indian coordinates. */
export async function fetchAqiByCoords(
  lat: number,
  lon: number,
  name?: string,
  state?: string,
  signal?: AbortSignal,
): Promise<AqiApiResponse> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
  });
  if (name !== undefined && name.trim().length > 0) {
    params.set('name', name.trim());
  }
  if (state !== undefined && state.trim().length > 0) {
    params.set('state', state.trim());
  }
  return requestJson<AqiApiResponse>(`/api/aqi?${params.toString()}`, {
    method: 'GET',
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Computes or retrieves the full grounded plan from POST /api/plan. */
export async function postPlan(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<FullPlanOutput> {
  return requestJson<FullPlanOutput>('/api/plan', {
    method: 'POST',
    body: JSON.stringify(profile),
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Synthesizes a grounded household action briefing via POST /api/plan/briefing. */
export async function postPlanBriefing(
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<PlanBriefingApiResponse> {
  return requestJson<PlanBriefingApiResponse>('/api/plan/briefing', {
    method: 'POST',
    body: JSON.stringify(profile),
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Compares baseline and alternative profiles via POST /api/what-if. */
export async function postWhatIf(
  baseline: UserProfile,
  alternative: UserProfile,
  signal?: AbortSignal,
): Promise<WhatIfComparisonResult> {
  return requestJson<WhatIfComparisonResult>('/api/what-if', {
    method: 'POST',
    body: JSON.stringify({ baseline, alternative }),
    ...(signal !== undefined ? { signal } : {}),
  });
}

/** Sends a grounded question to POST /api/ai/ask. */
export async function postAiAsk(
  question: string,
  profile: UserProfile,
  signal?: AbortSignal,
): Promise<AiAskApiResponse> {
  return requestJson<AiAskApiResponse>('/api/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ question, profile }),
    ...(signal !== undefined ? { signal } : {}),
  });
}
