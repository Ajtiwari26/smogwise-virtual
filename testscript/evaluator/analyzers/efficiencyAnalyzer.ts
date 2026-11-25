/**
 * Deterministic efficiency analyzer for SmogWise Virtual.
 * Evaluates repository hygiene, prod dependency count, Vite gzip bundle size,
 * Tier 1 O(N) scaling, and SHA-256 LRU cache behavior.
 */

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import zlib from 'node:zlib';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import {
  clamp,
  makeDeduction,
  round2,
  runShellCapture,
  safeDynamicImport,
} from '../utils.js';

const MAX_DETERMINISTIC = 12.0;
const BLOAT_CAP = 4.0;
const CRITERION = 'efficiency' as const;

const MB = 1024 * 1024;
const KB = 1024;

const SKIP_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.etta',
  '.git',
]);

interface RepoHygieneResult {
  readonly bytes: number;
  readonly branches: number;
  readonly deduction: number;
  readonly bloated: boolean;
}

interface BundleCheckResult {
  readonly depCount: number;
  readonly gzipKb: number;
  readonly deduction: number;
}

interface ImpactModule {
  readonly computeDeterministicReport?: (input: unknown) => unknown;
}

interface LruCacheInstance {
  readonly get: (key: string) => unknown;
  readonly set: (key: string, value: unknown) => void;
  readonly hashKey?: (input: unknown) => string;
}

interface LruModule {
  readonly LruCache?: new (maxEntries: number, ttlMs?: number) => LruCacheInstance;
  readonly createLruCache?: (maxEntries: number, ttlMs?: number) => LruCacheInstance;
  readonly hashCacheKey?: (input: unknown) => string;
}

function shouldDescend(rootDir: string, fullPath: string, name: string): boolean {
  if (SKIP_DIRS.has(name)) {
    return false;
  }
  const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
  return rel !== 'testscript/reports';
}

function sumDirBytes(rootDir: string, currentDir: string): number {
  if (!fs.existsSync(currentDir)) {
    return 0;
  }
  let total = 0;
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory() && shouldDescend(rootDir, fullPath, entry.name)) {
      total += sumDirBytes(rootDir, fullPath);
    } else if (entry.isFile()) {
      total += fs.statSync(fullPath).size;
    }
  }
  return total;
}

function evaluateRepoSize(bytes: number, deductions: DeductionItem[]): number {
  const mb = round2(bytes / MB);
  if (bytes >= 10 * MB) {
    deductions.push(
      makeDeduction(
        CRITERION,
        8.0,
        `Repository size is ${mb} MB (>= 10 MB limit).`,
        'Remove large assets or build artifacts to keep repo under 2 MB.',
      ),
    );
    return 8.0;
  }
  if (bytes >= 2 * MB) {
    deductions.push(
      makeDeduction(
        CRITERION,
        1.0,
        `Repository size is ${mb} MB (optimal < 2 MB).`,
        'Trim unused files or assets to stay under 2 MB.',
      ),
    );
    return 1.0;
  }
  return 0;
}

async function checkGitBranches(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<{ branches: number; deduction: number }> {
  if (!fs.existsSync(path.join(rootDir, '.git'))) {
    return { branches: 1, deduction: 0 };
  }
  const res = await runShellCapture('git', ['branch', '--list'], rootDir);
  const branches = res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0).length;
  if (branches <= 1) {
    return { branches, deduction: 0 };
  }
  deductions.push(
    makeDeduction(
      CRITERION,
      2.0,
      `Found ${branches} git branches; single-branch hygiene violated.`,
      'Delete merged or stale local branches so only 1 branch remains.',
    ),
  );
  return { branches, deduction: 2.0 };
}

async function checkRepoHygiene(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<RepoHygieneResult> {
  const bytes = sumDirBytes(rootDir, rootDir);
  const sizeDed = evaluateRepoSize(bytes, deductions);
  const gitRes = await checkGitBranches(rootDir, deductions);
  return {
    bytes,
    branches: gitRes.branches,
    deduction: round2(sizeDed + gitRes.deduction),
    bloated: bytes >= 10 * MB,
  };
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null;
}

function countProdDeps(rootDir: string): number {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = isRecord(parsed) ? parsed['dependencies'] : undefined;
    return isRecord(deps) ? Object.keys(deps).length : 0;
  } catch {
    return 0;
  }
}

function measureDistJsGzipKb(rootDir: string): number {
  const assetsDir = path.join(rootDir, 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    return 0;
  }
  let gzipBytes = 0;
  const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const buf = fs.readFileSync(path.join(assetsDir, file));
    gzipBytes += zlib.gzipSync(buf).byteLength;
  }
  return round2(gzipBytes / KB);
}

async function checkViteBundle(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<{ gzipKb: number; lost: number }> {
  if (!fs.existsSync(path.join(rootDir, 'src', 'main.tsx'))) {
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        'src/main.tsx missing; Vite bundle size check skipped.',
        'Ensure src/main.tsx exists and builds cleanly with Vite.',
      ),
    );
    return { gzipKb: 0, lost: 1.5 };
  }
  const viteBin = path.join(rootDir, 'node_modules', '.bin', 'vite');
  const build = await runShellCapture(viteBin, ['build'], rootDir);
  if (build.code !== 0) {
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        'Vite production build failed.',
        'Fix build errors so `vite build` succeeds.',
      ),
    );
    return { gzipKb: 0, lost: 1.5 };
  }
  const gzipKb = measureDistJsGzipKb(rootDir);
  if (gzipKb <= 150) {
    return { gzipKb, lost: 0 };
  }
  const pen = clamp(round2(((gzipKb - 150) / 50) * 0.5), 0.25, 1.5);
  deductions.push(
    makeDeduction(
      CRITERION,
      pen,
      `Gzipped JS bundle is ${gzipKb} KB (target <= 150 KB).`,
      'Code-split heavy modules and tree-shake unused imports.',
    ),
  );
  return { gzipKb, lost: pen };
}

async function checkDepsAndBundle(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<BundleCheckResult> {
  let lost = 0;
  const depCount = countProdDeps(rootDir);
  if (depCount > 12) {
    const pen = clamp(round2((depCount - 12) * 0.25), 0, 1.5);
    lost += pen;
    deductions.push(
      makeDeduction(
        CRITERION,
        pen,
        `package.json has ${depCount} prod dependencies (target <= 12).`,
        'Prune unnecessary production dependencies.',
      ),
    );
  }
  const vite = await checkViteBundle(rootDir, deductions);
  return {
    depCount,
    gzipKb: vite.gzipKb,
    deduction: clamp(round2(lost + vite.lost), 0, 3.0),
  };
}

function runTimedBatch(fn: (input: unknown) => unknown, iterations: number): number {
  const sample = {
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
  const start = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    fn(sample);
  }
  return performance.now() - start;
}

async function checkTier1Scaling(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<{ ratio: number; avgMs: number; deduction: number }> {
  const modPath = path.join(rootDir, 'src', 'domain', 'impactService.ts');
  const mod = await safeDynamicImport<ImpactModule>(modPath);
  if (mod === null || typeof mod.computeDeterministicReport !== 'function') {
    deductions.push(
      makeDeduction(
        CRITERION,
        3.0,
        'src/domain/impactService.ts (computeDeterministicReport) missing.',
        'Export computeDeterministicReport from src/domain/impactService.ts.',
      ),
    );
    return { ratio: 0, avgMs: 0, deduction: 3.0 };
  }
  const t240 = Math.max(runTimedBatch(mod.computeDeterministicReport, 240), 0.01);
  const t2400 = runTimedBatch(mod.computeDeterministicReport, 2400);
  const ratio = round2(t2400 / t240);
  const avgMs = round2(t2400 / 2400);
  let lost = 0;
  if (ratio >= 18) {
    lost += 1.5;
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        `Scaling ratio 2400/240 calls is ${ratio}x (expected < 18x).`,
        'Ensure computeDeterministicReport runs in O(1)/O(N) without leaks.',
      ),
    );
  }
  if (avgMs >= 2) {
    lost += 1.5;
    deductions.push(
      makeDeduction(
        CRITERION,
        1.5,
        `Average Tier 1 latency is ${avgMs} ms (expected < 2 ms).`,
        'Optimize hot-path calculations in computeDeterministicReport.',
      ),
    );
  }
  return { ratio, avgMs, deduction: clamp(round2(lost), 0, 3.0) };
}

function instantiateCache(mod: LruModule): LruCacheInstance | null {
  if (typeof mod.createLruCache === 'function') {
    return mod.createLruCache(2, 60_000);
  }
  if (typeof mod.LruCache === 'function') {
    return new mod.LruCache(2, 60_000);
  }
  return null;
}

function verifyCacheHash(
  hashFn: ((input: unknown) => string) | undefined,
  deductions: DeductionItem[],
): number {
  if (typeof hashFn !== 'function') {
    return 0;
  }
  const h1 = hashFn({ a: 1, b: 2 });
  const h2 = hashFn({ a: 1, b: 2 });
  if (typeof h1 === 'string' && h1.length >= 32 && h1 === h2) {
    return 0;
  }
  deductions.push(
    makeDeduction(
      CRITERION,
      1.0,
      'LRU cache key hashing is non-deterministic or not SHA-256.',
      'Use crypto.createHash("sha256") for deterministic cache keys.',
    ),
  );
  return 1.0;
}

async function checkLruCache(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<number> {
  const modPath = path.join(rootDir, 'server', 'cache', 'lruCache.ts');
  const mod = await safeDynamicImport<LruModule>(modPath);
  const cache = mod !== null ? instantiateCache(mod) : null;
  if (mod === null || cache === null) {
    deductions.push(
      makeDeduction(
        CRITERION,
        2.0,
        'server/cache/lruCache.ts missing or lacks LruCache/createLruCache.',
        'Implement and export LruCache or createLruCache in server/cache/lruCache.ts.',
      ),
    );
    return 2.0;
  }
  let lost = verifyCacheHash(mod.hashCacheKey ?? cache.hashKey, deductions);
  cache.set('k1', 'v1');
  cache.set('k2', 'v2');
  cache.get('k1');
  cache.set('k3', 'v3');
  if (cache.get('k2') !== undefined || cache.get('k1') !== 'v1') {
    lost += 1.0;
    deductions.push(
      makeDeduction(
        CRITERION,
        1.0,
        'LRU cache did not evict least-recently-used entry at maxEntries=2.',
        'Promote accessed keys and evict oldest key when size exceeds maxEntries.',
      ),
    );
  }
  return clamp(round2(lost), 0, 2.0);
}

/**
 * Runs deterministic efficiency checks for SmogWise Virtual.
 */
export async function runEfficiencyAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const deductions: DeductionItem[] = [];
  const hygiene = await checkRepoHygiene(rootDir, deductions);
  const bundle = await checkDepsAndBundle(rootDir, deductions);
  const scaling = await checkTier1Scaling(rootDir, deductions);
  const lruLost = await checkLruCache(rootDir, deductions);

  const totalLost = round2(
    hygiene.deduction + bundle.deduction + scaling.deduction + lruLost,
  );
  const raw = clamp(round2(MAX_DETERMINISTIC - totalLost), 0, MAX_DETERMINISTIC);
  const capApplied = hygiene.bloated ? BLOAT_CAP : undefined;
  const finalScore = capApplied !== undefined ? Math.min(raw, capApplied) : raw;

  return {
    criterion: CRITERION,
    deterministicScore: round2(finalScore),
    maxDeterministic: MAX_DETERMINISTIC,
    ...(capApplied !== undefined ? { capApplied } : {}),
    deductions,
    metrics: {
      repoSizeMb: round2(hygiene.bytes / MB),
      gitBranches: hygiene.branches,
      prodDependencies: bundle.depCount,
      bundleGzipKb: bundle.gzipKb,
      scalingRatio: scaling.ratio,
      avgTier1Ms: scaling.avgMs,
    },
  };
}