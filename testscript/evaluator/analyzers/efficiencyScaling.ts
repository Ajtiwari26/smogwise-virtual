/**
 * Tier 1 O(N) scaling benchmark and SHA-256 LRU cache verification for efficiencyAnalyzer.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import type { UserProfile } from '../../../src/domain/types.js';
import type { DeductionItem } from '../types.js';
import { clamp, isPlainRecord, makeDeduction, round2, safeDynamicImport } from '../utils.js';

const CRITERION = 'efficiency' as const;

const SAMPLE_PROFILE: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: true,
  monthlyBudgetInr: 3000,
  roomVolumeM3: 45,
  commuteMode: 'petrol_car',
  commuteDistanceKm: 18,
  cookingFuel: 'lpg',
  activeHacks: ['window_sealing', 'n95_mask'],
};

interface LruCacheLike {
  readonly get: (key: string) => unknown;
  readonly set: (key: string, value: unknown) => void;
  readonly delete: (key: string) => unknown;
  readonly hashKey?: (input: unknown) => string;
}

function runTimedBatch(work: () => unknown, iterations = 1): number {
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    work();
  }
  return performance.now() - start;
}

function percentile(samples: readonly number[], fraction: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? 0;
}

function measureStepScaling(simulate: (outdoor: readonly number[]) => unknown) {
  const outdoor = Array.from(
    { length: 2400 }, (_, hour) => 155 + 45 * Math.cos(hour * Math.PI / 12),
  );
  const standard = outdoor.slice(0, 24);
  const medium = outdoor.slice(0, 240);
  const shortTimes: number[] = [];
  const mediumTimes: number[] = [];
  const longTimes: number[] = [];
  runTimedBatch(() => simulate(outdoor), 12);
  for (let sample = 0; sample < 11; sample += 1) {
    shortTimes.push(runTimedBatch(() => simulate(standard), 16));
    mediumTimes.push(runTimedBatch(() => simulate(medium), 16));
    longTimes.push(runTimedBatch(() => simulate(outdoor), 16));
  }
  const t24 = percentile(shortTimes, 0.5);
  const t240 = percentile(mediumTimes, 0.5);
  const t2400 = percentile(longTimes, 0.5);
  return { shortRatio: t240 / t24, longRatio: t2400 / t240 };
}

function scoreScaling(longRatio: number, p95Ms: number, deductions: DeductionItem[]): number {
  let lost = 0;
  if (longRatio >= 18) {
    lost += 1.5;
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        `Scaling ratio for 2400/240 indoor steps is ${round2(longRatio)}x (expected < 18x).`,
        'Keep the indoor mass-balance simulation linear in the number of input steps.',
      ),
    );
  }
  if (p95Ms >= 2) {
    lost += 1.5;
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        `24-hour Tier 1 p95 latency is ${round2(p95Ms)} ms (expected < 2 ms).`,
        'Optimize hot-path calculations in computeDeterministicReport.',
      ),
    );
  }
  return lost;
}

/** Measures real indoor-series scaling and standard 24-hour Tier 1 p95 latency. */
export async function checkTier1Scaling(rootDir: string, deductions: DeductionItem[]) {
  const mod = await safeDynamicImport(path.join(rootDir, 'src', 'domain', 'impactService.ts'));
  const exposure = await safeDynamicImport(path.join(rootDir, 'src', 'domain', 'exposureEngine.ts'));
  const compute = mod?.['computeDeterministicReport'];
  const simulate = exposure?.['computeIndoorSeries'];
  if (typeof compute !== 'function' || typeof simulate !== 'function') {
    deductions.push(
      makeDeduction(
        CRITERION,
        3.0,
        'Tier 1 report or indoor-series computation unavailable.',
        'Export computeDeterministicReport and computeIndoorSeries from the Tier 1 modules.',
      ),
    );
    return { shortRatio: 0, longRatio: 0, avgMs: 0, p95Ms: 0, deduction: 3.0 };
  }
  const { shortRatio, longRatio } = measureStepScaling(
    (outdoor): unknown => simulate(outdoor, SAMPLE_PROFILE, true),
  );
  const runReport = (): unknown => compute(SAMPLE_PROFILE);
  runTimedBatch(runReport, 120);
  const times = Array.from({ length: 101 }, () => runTimedBatch(runReport));
  const avgMs = times.reduce((sum, time) => sum + time, 0) / times.length;
  const p95Ms = percentile(times, 0.95);
  return {
    shortRatio: round2(shortRatio),
    longRatio: round2(longRatio),
    avgMs: round2(avgMs),
    p95Ms: round2(p95Ms),
    deduction: scoreScaling(longRatio, p95Ms, deductions),
  };
}

function isLruCacheLike(val: unknown): val is LruCacheLike {
  return isPlainRecord(val) &&
    typeof val['get'] === 'function' &&
    typeof val['set'] === 'function' &&
    typeof val['delete'] === 'function';
}

function instantiateCache(mod: Record<string, unknown>): LruCacheLike | null {
  const createFn = mod['createLruCache'];
  if (typeof createFn === 'function') {
    const instance: unknown = createFn(2, 60_000);
    return isLruCacheLike(instance) ? instance : null;
  }
  return null;
}

function hasStableHash(hashKey: unknown): hashKey is (input: unknown) => string {
  if (typeof hashKey !== 'function') return false;
  const expected = createHash('sha256').update('{"a":1,"b":2}').digest('hex');
  return hashKey({ a: 1, b: 2 }) === expected && hashKey({ b: 2, a: 1 }) === expected;
}

function measureCacheSpeedup(
  cache: LruCacheLike,
  hashKey: (input: unknown) => string,
  compute: () => unknown,
): number {
  const input = { route: 'plan', profile: SAMPLE_PROFILE, liveAq: null };
  const cacheKey = hashKey(input);
  const readCached = (): unknown => {
    const cached = cache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
    const key = hashKey(input);
    const computed = compute();
    cache.set(key, computed);
    return computed;
  };
  const loadColdBatch = () => {
    const start = performance.now();
    for (let i = 0; i < 8; i += 1) {
      cache.delete(cacheKey);
      readCached();
    }
    return performance.now() - start;
  };
  runTimedBatch(loadColdBatch, 16);
  const cold: number[] = [];
  const warm: number[] = [];
  for (let sample = 0; sample < 41; sample += 1) {
    cold.push(loadColdBatch());
    warm.push(runTimedBatch(readCached, 8));
  }
  return percentile(cold, 0.5) / percentile(warm, 0.5);
}

function scoreCacheSpeedup(speedup: number, deductions: DeductionItem[]): number {
  if (speedup >= 5) return 0;
  deductions.push(
    makeDeduction(
      CRITERION,
      0.5,
      `Repeated plan cache speedup is ${round2(speedup)}x (expected >= 5x).`,
      'Reduce cache-hit overhead and keep plan calculation on the cache-miss path.',
    ),
  );
  return 0.5;
}

function scoreCacheEviction(cache: LruCacheLike, deductions: DeductionItem[]): number {
  cache.set('k1', 'v1');
  cache.set('k2', 'v2');
  cache.get('k1');
  cache.set('k3', 'v3');
  if (cache.get('k2') === undefined && cache.get('k1') === 'v1') return 0;
  deductions.push(
    makeDeduction(
      CRITERION,
      1.0,
      'LRU cache did not evict least-recently-used entry at maxEntries=2.',
      'Promote accessed keys and evict oldest key when size exceeds maxEntries.',
    ),
  );
  return 1.0;
}

/** Verifies SHA-256 cache hashing, eviction ordering, and repeated-plan hit speedup. */
export async function checkLruCache(rootDir: string, deductions: DeductionItem[]) {
  const mod = await safeDynamicImport(path.join(rootDir, 'server', 'cache', 'lruCache.ts'));
  const cache = mod === null ? null : instantiateCache(mod);
  if (cache === null) {
    deductions.push(
      makeDeduction(
        CRITERION,
        2.0,
        'server/cache/lruCache.ts missing or lacks a usable createLruCache.',
        'Export a bounded LRU cache with get, set, and delete.',
      ),
    );
    return { deduction: 2.0, speedup: 0 };
  }
  const hashKey = mod?.['hashCacheKey'] ?? cache.hashKey;
  const impact = await safeDynamicImport(path.join(rootDir, 'src', 'domain', 'impactService.ts'));
  const compute = impact?.['computeFullPlan'];
  let lost = 0;
  let speedup = 0;
  if (hasStableHash(hashKey)) {
    if (typeof compute === 'function') {
      speedup = measureCacheSpeedup(cache, hashKey, (): unknown => compute(SAMPLE_PROFILE));
    }
  } else {
    lost += 0.5;
    deductions.push(
      makeDeduction(
        CRITERION,
        0.5,
        'LRU cache key hashing is non-deterministic or lacks a canonical SHA-256 digest.',
        'Use crypto.createHash("sha256") with canonical input for cache keys.',
      ),
    );
  }
  lost += scoreCacheSpeedup(speedup, deductions);
  lost += scoreCacheEviction(cache, deductions);
  return { deduction: clamp(round2(lost), 0, 2.0), speedup: round2(speedup) };
}
