/**
 * Express API routes for SmogWise Virtual.
 * Mounts isolated rate limiters, explicit Cache-Control headers, and Zod v4 validation.
 */

import express from 'express';
import type { NextFunction, Request, Response, Router } from 'express';
import type { z } from 'zod';
import { compareWhatIf, computeFullPlan } from '../../src/domain/impactService.js';
import type { FullPlanOutput, UserProfile } from '../../src/domain/types.js';
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
import { askGroundedAssistant, generatePlanBriefing } from '../services/genaiService.js';
import {
  fetchAirQualityForCity,
  fetchAirQualityForCoords,
  LiveAqUnavailableError,
} from '../services/openMeteoClient.js';
import {
  buildDefaultProfile,
  extractProfilePayload,
  resolveProfileAq,
  toUserProfile,
} from './apiRouteHelpers.js';
import { createAuthRouter } from './authRoutes.js';

const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const CITY_AQI_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const planCache = createLruCache<FullPlanOutput>(200, PLAN_CACHE_TTL_MS);

async function resolveOrComputePlan(profile: UserProfile): Promise<FullPlanOutput> {
  const aqResult = await resolveProfileAq(profile);
  const cacheKey = hashCacheKey({ route: 'plan', profile, liveAq: aqResult.liveAq ?? null });
  const cached = planCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const plan = computeFullPlan(profile, aqResult.liveAq);
  planCache.set(cacheKey, plan, PLAN_CACHE_TTL_MS);
  return plan;
}

function sendLiveAqUnavailable(res: Response, err: LiveAqUnavailableError): void {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(503).json({ error: err.code, message: err.message });
}

function handleHealth(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
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
  res.setHeader('Cache-Control', 'private, no-store');
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
  res.setHeader('Cache-Control', 'private, no-store');
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
  res.setHeader('Cache-Control', CITY_AQI_CACHE_CONTROL);
  res.status(200).json(result);
}

async function handleAqi(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = AqiQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.setHeader('Cache-Control', 'private, no-store');
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
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const parsed = UserProfileSchema.parse(extractProfilePayload(req.body));
    const plan = await resolveOrComputePlan(toUserProfile(parsed));
    res.status(200).json(plan);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

async function handlePlanBriefing(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    const parsed = UserProfileSchema.parse(extractProfilePayload(req.body));
    const profile = toUserProfile(parsed);
    const plan = await resolveOrComputePlan(profile);
    const briefing = await generatePlanBriefing(profile, plan.report);
    res.status(200).json(briefing);
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

function isSameLocationTarget(
  a: ReturnType<typeof toUserProfile>,
  b: ReturnType<typeof toUserProfile>,
): boolean {
  if (a.customLocation !== undefined || b.customLocation !== undefined) {
    return (
      a.customLocation !== undefined &&
      b.customLocation !== undefined &&
      a.customLocation.lat === b.customLocation.lat &&
      a.customLocation.lon === b.customLocation.lon
    );
  }
  return a.cityId === b.cityId;
}

async function handleWhatIf(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
  try {
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
  } catch (err) {
    if (err instanceof LiveAqUnavailableError) {
      sendLiveAqUnavailable(res, err);
      return;
    }
    next(err);
  }
}

async function handleAiAsk(req: Request, res: Response, next: NextFunction): Promise<void> {
  res.setHeader('Cache-Control', 'private, no-store');
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
  router.get('/locations/search', geoLimiter, (req, res, next) => {
    void handleLocationsSearch(req, res, next);
  });
  router.get('/aqi', planLimiter, (req, res, next) => {
    void handleAqi(req, res, next);
  });
  router.post('/plan', planLimiter, (req, res, next) => {
    void handlePlan(req, res, next);
  });
  router.post('/plan/briefing', briefingLimiter, (req, res, next) => {
    void handlePlanBriefing(req, res, next);
  });
  router.post('/what-if', planLimiter, (req, res, next) => {
    void handleWhatIf(req, res, next);
  });
  router.post('/ai/ask', aiAskLimiter, (req, res, next) => {
    void handleAiAsk(req, res, next);
  });

  return router;
}
