/**
 * Express API routes for SmogWise Virtual.
 * Mounts isolated rate limiters per route group and validates all inputs with Zod v4.
 */

import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import type { z } from 'zod';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { compareWhatIf, computeFullPlan } from '../../src/domain/impactService.js';
import type { FullPlanOutput, LanguageCode, UserProfile } from '../../src/domain/types.js';
import { createLruCache, hashCacheKey } from '../cache/lruCache.js';
import {
  AqiQuerySchema,
  LocationSearchQuerySchema,
  StrictCoordSchema,
} from '../middleware/locationGuard.js';
import {
  AiAskSchema,
  UserProfileSchema,
  WhatIfSchema,
} from '../middleware/promptGuard.js';
import { createRouteLimiters } from '../middleware/security.js';
import { searchIndianLocations } from '../services/geocodingClient.js';
import { askGroundedAssistant } from '../services/genaiService.js';
import {
  fetchAirQualityForCity,
  fetchAirQualityForCoords,
  isUnsafeCityInput,
  LiveAqUnavailableError,
} from '../services/openMeteoClient.js';
import type { AirQualityLookupResult } from '../services/openMeteoClient.js';

type ParsedProfile = z.infer<typeof UserProfileSchema>;

const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const planCache = createLruCache<FullPlanOutput>(200, PLAN_CACHE_TTL_MS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toCustomLocation(
  raw: NonNullable<ParsedProfile['customLocation']>,
): NonNullable<UserProfile['customLocation']> {
  if (raw.state !== undefined && raw.state.length > 0) {
    return {
      name: raw.name,
      state: raw.state,
      lat: raw.lat,
      lon: raw.lon,
    };
  }
  return {
    name: raw.name,
    lat: raw.lat,
    lon: raw.lon,
  };
}

function toUserProfile(parsed: ParsedProfile): UserProfile {
  const customLocation =
    parsed.customLocation !== undefined ? toCustomLocation(parsed.customLocation) : undefined;
  return {
    persona: parsed.persona,
    cityId: parsed.cityId,
    language: parsed.language,
    householdSize: parsed.householdSize,
    hasVulnerableMember: parsed.hasVulnerableMember,
    monthlyBudgetInr: parsed.monthlyBudgetInr,
    roomVolumeM3: parsed.roomVolumeM3,
    commuteMode: parsed.commuteMode,
    commuteDistanceKm: parsed.commuteDistanceKm,
    cookingFuel: parsed.cookingFuel,
    activeHacks: parsed.activeHacks,
    ...(customLocation !== undefined ? { customLocation } : {}),
    ...(parsed.rwaHouseholds !== undefined ? { rwaHouseholds: parsed.rwaHouseholds } : {}),
    ...(parsed.rwaAdoptionRate !== undefined ? { rwaAdoptionRate: parsed.rwaAdoptionRate } : {}),
  };
}

function buildDefaultProfile(city?: string, language: LanguageCode = 'en'): UserProfile {
  const safeCity = city !== undefined && !isUnsafeCityInput(city) ? city : 'delhi_anand_vihar';
  const preset = resolveCityPreset(safeCity);
  return {
    persona: 'young_family',
    cityId: preset.id,
    language,
    householdSize: 4,
    hasVulnerableMember: true,
    monthlyBudgetInr: 3000,
    roomVolumeM3: 45,
    commuteMode: 'petrol_car',
    commuteDistanceKm: 15,
    cookingFuel: 'lpg',
    activeHacks: ['window_sealing', 'wet_mopping'],
  };
}

function extractProfilePayload(body: unknown): unknown {
  if (isRecord(body) && 'profile' in body) {
    return body['profile'];
  }
  return body;
}

async function resolveProfileAq(profile: UserProfile): Promise<AirQualityLookupResult> {
  if (profile.customLocation !== undefined) {
    const loc = profile.customLocation;
    return fetchAirQualityForCoords({
      lat: loc.lat,
      lon: loc.lon,
      name: loc.name,
      ...(loc.state !== undefined ? { state: loc.state } : {}),
    });
  }
  return fetchAirQualityForCity(profile.cityId);
}

function sendLiveAqUnavailable(res: Response, err: LiveAqUnavailableError): void {
  res.status(503).json({
    error: err.code,
    message: err.message,
  });
}

function handleHealth(_req: Request, res: Response): void {
  res.status(200).json({
    status: 'ok',
    service: 'smogwise-virtual',
    timestamp: new Date().toISOString(),
  });
}

async function handleLocationsSearch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const parsed = LocationSearchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid location search query.';
      res.status(400).json({ error: 'INVALID_QUERY', message });
      return;
    }
    const results = await searchIndianLocations(parsed.data.q);
    res.status(200).json({ results });
  } catch (err) {
    next(err);
  }
}

type ParsedAqiQuery = z.infer<typeof AqiQuerySchema>;

async function handleAqiCoordinateLookup(data: ParsedAqiQuery, res: Response): Promise<void> {
  const latNum = StrictCoordSchema.parse(data.lat);
  const lonNum = StrictCoordSchema.parse(data.lon);
  const result = await fetchAirQualityForCoords({
    lat: latNum,
    lon: lonNum,
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.state !== undefined ? { state: data.state } : {}),
  });
  res.status(200).json(result);
}

async function handleAqiCityLookup(data: ParsedAqiQuery, res: Response): Promise<void> {
  const cityInput = data.city ?? data.cityId ?? 'delhi_anand_vihar';
  const result = await fetchAirQualityForCity(cityInput);
  res.status(200).json(result);
}

async function handleAqi(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = AqiQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.issues[0]?.message ?? 'Invalid AQI query parameters.';
      res.status(400).json({ error: 'INVALID_QUERY', message });
      return;
    }
    if (parsed.data.lat !== undefined && parsed.data.lon !== undefined) {
      await handleAqiCoordinateLookup(parsed.data, res);
      return;
    }
    await handleAqiCityLookup(parsed.data, res);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

async function handlePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = UserProfileSchema.parse(extractProfilePayload(req.body));
    const profile = toUserProfile(parsed);
    const aqResult = await resolveProfileAq(profile);
    const cacheKey = hashCacheKey({
      route: 'plan',
      profile,
      liveAq: aqResult.liveAq ?? null,
    });
    const cached = planCache.get(cacheKey);
    if (cached !== undefined) {
      res.status(200).json(cached);
      return;
    }
    const plan = computeFullPlan(profile, aqResult.liveAq);
    planCache.set(cacheKey, plan, PLAN_CACHE_TTL_MS);
    res.status(200).json(plan);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

async function handleWhatIf(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = WhatIfSchema.parse(req.body);
    const baseline = toUserProfile(parsed.baseline);
    const alternative = toUserProfile(parsed.alternative);
    const aqResult = await resolveProfileAq(baseline);
    const comparison = compareWhatIf(baseline, alternative, aqResult.liveAq);
    res.status(200).json(comparison);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

async function handleAiAsk(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = AiAskSchema.parse(req.body);
    const question = parsed.question ?? parsed.query ?? '';
    const profile =
      parsed.profile !== undefined
        ? toUserProfile(parsed.profile)
        : buildDefaultProfile(parsed.city, parsed.language ?? 'en');
    const aqResult = await resolveProfileAq(profile);
    const response = await askGroundedAssistant({
      question,
      profile,
      ...(aqResult.liveAq !== undefined ? { liveAq: aqResult.liveAq } : {}),
    });
    res.status(200).json(response);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

/**
 * Creates the Express API router with isolated per-route-group rate limiters.
 */
export function createApiRouter(): Router {
  const router = express.Router();
  const { healthLimiter, geoLimiter, planLimiter, aiAskLimiter } = createRouteLimiters();

  router.get('/health', healthLimiter, handleHealth);
  router.get('/locations/search', geoLimiter, (req, res, next) => {
    void handleLocationsSearch(req, res, next);
  });
  router.get('/aqi', planLimiter, (req, res, next) => {
    void handleAqi(req, res, next);
  });
  router.post('/plan', planLimiter, (req, res, next) => {
    void handlePlan(req, res, next);
  });
  router.post('/what-if', planLimiter, (req, res, next) => {
    void handleWhatIf(req, res, next);
  });
  router.post('/ai/ask', aiAskLimiter, (req, res, next) => {
    void handleAiAsk(req, res, next);
  });

  return router;
}
