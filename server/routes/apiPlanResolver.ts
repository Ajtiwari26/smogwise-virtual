/**
 * Coordinated /api/plan, /api/plan/briefing, and /api/ai/ask snapshot resolver with
 * short-lived LRU caching, signed snapshot reuse, and non-local offline fallbacks.
 */

import { computeFullPlan } from '../../src/domain/impactService.js';
import { resolveReportAq } from '../../src/domain/liveAqResolver.js';
import type { FullPlanOutput, LiveAqOverride, UserProfile } from '../../src/domain/types.js';
import { createLruCache, hashCacheKey } from '../cache/lruCache.js';
import { signAqSnapshotToken, verifyAqSnapshotToken } from '../services/aqSnapshotToken.js';
import { isBudgetQuestion } from '../services/genaiBudget.js';
import { isPlantsQuestion } from '../services/genaiOfflineFallbacks.js';
import { LiveAqUnavailableError } from '../services/openMeteoClient.js';
import { resolveProfileAq } from './apiRouteHelpers.js';

const PLAN_CACHE_TTL_MS = 10 * 60 * 1000;
const planCache = createLruCache<FullPlanOutput>(200, PLAN_CACHE_TTL_MS);

function getCachedOrComputePlan(
  profile: UserProfile,
  aqStatus: string,
  observationId: string,
  liveAq?: LiveAqOverride,
): FullPlanOutput {
  const canonicalProfile: UserProfile = {
    ...profile,
    activeHacks: [...profile.activeHacks].sort(),
  };
  const cacheKey = hashCacheKey({
    route: 'plan',
    aqStatus,
    observationId,
    profile: canonicalProfile,
    liveAq: liveAq ?? null,
  });
  const cached = planCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const plan = computeFullPlan(canonicalProfile, liveAq);
  planCache.set(cacheKey, plan, PLAN_CACHE_TTL_MS);
  return plan;
}

/** Resolves AQ (live or preset) and computes/caches the deterministic plan. */
export async function resolvePlanWithAq(
  profile: UserProfile,
  useLiveAq = true,
): Promise<{ readonly plan: FullPlanOutput; readonly liveAq?: LiveAqOverride }> {
  const aq = useLiveAq ? await resolveProfileAq(profile) : resolveReportAq(profile);
  const liveAq = 'liveAq' in aq ? aq.liveAq : undefined;
  const plan = getCachedOrComputePlan(profile, aq.aqStatus, aq.observationId, liveAq);
  return { plan, ...(liveAq !== undefined ? { liveAq } : {}) };
}

/** Reuses a valid signed snapshot token or resolves live AQ once per plan/briefing call. */
export async function resolvePlanFromSnapshotOrLive(
  profile: UserProfile,
  useLiveAq: boolean,
  snapshotToken?: string,
): Promise<{
  readonly plan: FullPlanOutput;
  readonly liveAq?: LiveAqOverride;
  readonly snapshotToken?: string;
}> {
  if (useLiveAq) {
    const verified = verifyAqSnapshotToken(snapshotToken, profile);
    if (verified.valid) {
      const aq = resolveReportAq(profile, verified.liveAq);
      const plan = getCachedOrComputePlan(profile, aq.aqStatus, aq.observationId, verified.liveAq);
      return {
        plan,
        ...(verified.liveAq !== undefined ? { liveAq: verified.liveAq } : {}),
        ...(snapshotToken !== undefined ? { snapshotToken } : {}),
      };
    }
  }
  const resolved = await resolvePlanWithAq(profile, useLiveAq);
  if (!useLiveAq) return resolved;
  return {
    ...resolved,
    snapshotToken: signAqSnapshotToken(profile, resolved.liveAq),
  };
}

/** Resolves plan for /api/ai/ask, allowing budget and plant-vs-HEPA queries when AQ is offline. */
export async function resolveAiAskPlan(
  profile: UserProfile,
  snapshotToken: string | undefined,
  question: string,
): Promise<{
  readonly plan: FullPlanOutput;
  readonly liveAq?: LiveAqOverride;
  readonly snapshotToken?: string;
}> {
  try {
    return await resolvePlanFromSnapshotOrLive(profile, true, snapshotToken);
  } catch (err: unknown) {
    if (
      err instanceof LiveAqUnavailableError &&
      (isBudgetQuestion(question) || isPlantsQuestion(question))
    ) {
      return { plan: computeFullPlan(profile) };
    }
    throw err;
  }
}
