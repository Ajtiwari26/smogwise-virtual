/**
 * Express API routes for SmogWise Virtual.
 * Mounts isolated rate limiters, explicit Cache-Control headers, and Zod v4 validation.
 */

import express from 'express';
import type { Request, Response, Router } from 'express';
import type { z } from 'zod';
import { compareWhatIf, computeFullPlan } from '../../src/domain/impactService.js';
import { isSameLocationTarget } from '../../src/domain/liveAqResolver.js';
import type { FullPlanOutput, UserProfile } from '../../src/domain/types.js';
import { createLruCache, hashCacheKey } from '../cache/lruCache.js';
import {
  AqiQuerySchema,
  LocationSearchQuerySchema,
} from '../middleware/locationGuard.js';
import {
  AiAskSchema,
  WhatIfSchema,
} from '../middleware/requestSchemas.js';
import { createRouteLimiters } from '../middleware/security.js';
import { searchIndianLocations } from '../services/geocodingClient.js';
import { askGroundedAssistant, generatePlanBriefing } from '../services/genaiService.js';
import {
  fetchAirQualityForCity,
  fetchAirQualityForCoords,
} from '../services/openMeteoClient.js';
import {
  buildDefaultProfile,
  parsePlanRequest,
  resolveProfileAq,
  toUserProfile,
  wrapAqRoute,
} from './apiRouteHelpers.js';
import { createAuthRouter } from './authRoutes.js';

const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const CITY_AQI_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const planCache = createLruCache<FullPlanOutput>(200, PLAN_CACHE_TTL_MS);

async function resolveOrComputePlan(
  profile: UserProfile,
  useLiveAq = true,
): Promise<FullPlanOutput> {
  const liveAq = useLiveAq ? (await resolveProfileAq(profile)).liveAq : undefined;
  const canonicalProfile: UserProfile = {
    ...profile,
    activeHacks: [...profile.activeHacks].sort(),
  };
  const cacheKey = hashCacheKey({
    route: 'plan',
    profile: canonicalProfile,
    liveAq: liveAq ?? null,
  });
  const cached = planCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const plan = computeFullPlan(canonicalProfile, liveAq);
  planCache.set(cacheKey, plan, PLAN_CACHE_TTL_MS);
  return plan;
}

function handleHealth(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    status: 'ok',
    service: 'smogwise-virtual',
    timestamp: new Date().toISOString(),
  });
}

async function handleLocationsSearch(req: Request, res: Response): Promise<void> {
  const parsed = LocationSearchQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? 'Invalid location search query.';
    res.status(400).json({ error: 'INVALID_QUERY', message });
    return;
  }
  const results = await searchIndianLocations(parsed.data.q);
  res.status(200).json({ results });
}

type ParsedAqiQuery = z.infer<typeof AqiQuerySchema>;

async function handleAqiCoordinateLookup(data: ParsedAqiQuery, res: Response): Promise<void> {
  const result = await fetchAirQualityForCoords({
    lat: Number(data.lat),
    lon: Number(data.lon),
    ...(data.name !== undefined ? { name: data.name } : {}),
    ...(data.state !== undefined ? { state: data.state } : {}),
  });
  res.status(200).json(result);
}

async function handleAqiCityLookup(data: ParsedAqiQuery, res: Response): Promise<void> {
  const cityInput = data.city ?? data.cityId ?? 'delhi_anand_vihar';
  const result = await fetchAirQualityForCity(cityInput);
  res.setHeader(
    'Cache-Control',
    result.dataSource === 'live_open_meteo' ? CITY_AQI_CACHE_CONTROL : 'private, no-store',
  );
  res.status(200).json(result);
}

async function handleAqi(req: Request, res: Response): Promise<void> {
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
}

async function handlePlan(req: Request, res: Response): Promise<void> {
  const { profile, useLiveAq } = parsePlanRequest(req.body);
  const plan = await resolveOrComputePlan(profile, useLiveAq);
  res.status(200).json(plan);
}

async function handlePlanBriefing(req: Request, res: Response): Promise<void> {
  const { profile, useLiveAq } = parsePlanRequest(req.body);
  const plan = await resolveOrComputePlan(profile, useLiveAq);
  const briefing = await generatePlanBriefing(profile, plan.report);
  res.status(200).json(briefing);
}

async function handleWhatIf(req: Request, res: Response): Promise<void> {
  const parsed = WhatIfSchema.parse(req.body);
  const baseline = toUserProfile(parsed.baseline);
  const alternative = toUserProfile(parsed.alternative);
  if (isSameLocationTarget(baseline, alternative)) {
    const aqResult = await resolveProfileAq(baseline);
    res.status(200).json(compareWhatIf(baseline, alternative, aqResult.liveAq));
    return;
  }
  const [baseAq, altAq] = await Promise.all([
    resolveProfileAq(baseline),
    resolveProfileAq(alternative),
  ]);
  res.status(200).json(compareWhatIf(baseline, alternative, baseAq.liveAq, altAq.liveAq));
}

async function handleAiAsk(req: Request, res: Response): Promise<void> {
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
}

/** Creates the Express API router with isolated per-route-group rate limiters. */
export function createApiRouter(): Router {
  const router = express.Router();
  const {
    healthLimiter,
    geoLimiter,
    planLimiter,
    sessionLimiter,
    aiAskLimiter,
    briefingLimiter,
    authLimiter,
  } = createRouteLimiters();

  router.use(createAuthRouter(authLimiter, sessionLimiter));
  router.get('/health', healthLimiter, handleHealth);
  router.get('/locations/search', geoLimiter, wrapAqRoute(handleLocationsSearch));
  router.get('/aqi', planLimiter, wrapAqRoute(handleAqi));
  router.post('/plan', planLimiter, wrapAqRoute(handlePlan));
  router.post('/plan/briefing', briefingLimiter, wrapAqRoute(handlePlanBriefing));
  router.post('/what-if', planLimiter, wrapAqRoute(handleWhatIf));
  router.post('/ai/ask', aiAskLimiter, wrapAqRoute(handleAiAsk));

  return router;
}
