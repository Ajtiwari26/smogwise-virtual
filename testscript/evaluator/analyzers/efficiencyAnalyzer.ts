/**
 * Deterministic efficiency analyzer for SmogWise Virtual.
 * Evaluates repository hygiene, prod dependency count, Vite gzip bundle size,
 * Tier 1 O(N) scaling, and SHA-256 LRU cache behavior.
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import { clamp, isPlainRecord, makeDeduction, round2, runShellCapture } from '../utils.js';
import { checkLruCache, checkTier1Scaling } from './efficiencyScaling.js';

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
  '.code-review-graph',
  '.git',
  '.vitest',
]);

function shouldDescend(rootDir: string, fullPath: string, name: string): boolean {
  if (SKIP_DIRS.has(name)) return false;
  return path.relative(rootDir, fullPath).split(path.sep).join('/') !== 'testscript/reports';
}

function sumDirBytes(rootDir: string, currentDir: string): number {
  if (!fs.existsSync(currentDir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
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
): Promise<{ readonly branches: number; readonly deduction: number }> {
  if (!fs.existsSync(path.join(rootDir, '.git'))) return { branches: 1, deduction: 0 };
  const res = await runShellCapture('git', ['branch', '--list'], rootDir);
  const branches = res.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0).length;
  if (branches <= 1) return { branches, deduction: 0 };
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

function countProdDeps(rootDir: string): number {
  const pkgPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return 0;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = isPlainRecord(parsed) ? parsed['dependencies'] : undefined;
    return isPlainRecord(deps) ? Object.keys(deps).length : 0;
  } catch (err: unknown) {
    void err;
    return 0;
  }
}

function measureDistJsGzipKb(rootDir: string): number {
  const assetsDir = path.join(rootDir, 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) return 0;
  let gzipBytes = 0;
  for (const file of fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'))) {
    gzipBytes += zlib.gzipSync(fs.readFileSync(path.join(assetsDir, file))).byteLength;
  }
  return round2(gzipBytes / KB);
}

async function checkViteBundle(
  rootDir: string,
  deductions: DeductionItem[],
): Promise<{ readonly gzipKb: number; readonly lost: number }> {
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
  if (gzipKb <= 150) return { gzipKb, lost: 0 };
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

async function checkDepsAndBundle(rootDir: string, deductions: DeductionItem[]) {
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
  return { depCount, gzipKb: vite.gzipKb, deduction: clamp(round2(lost + vite.lost), 0, 3.0) };
}

/** Runs deterministic efficiency checks for SmogWise Virtual. */
export async function runEfficiencyAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const deductions: DeductionItem[] = [];
  const bytes = sumDirBytes(rootDir, rootDir);
  const sizeDed = evaluateRepoSize(bytes, deductions);
  const gitRes = await checkGitBranches(rootDir, deductions);
  const hygieneDed = round2(sizeDed + gitRes.deduction);
  const bundle = await checkDepsAndBundle(rootDir, deductions);
  const scaling = await checkTier1Scaling(rootDir, deductions);
  const lru = await checkLruCache(rootDir, deductions);

  const totalLost = round2(hygieneDed + bundle.deduction + scaling.deduction + lru.deduction);
  const raw = clamp(round2(MAX_DETERMINISTIC - totalLost), 0, MAX_DETERMINISTIC);
  const capApplied = bytes >= 10 * MB ? BLOAT_CAP : undefined;
  const finalScore = capApplied !== undefined ? Math.min(raw, capApplied) : raw;

  return {
    criterion: CRITERION,
    deterministicScore: round2(finalScore),
    maxDeterministic: MAX_DETERMINISTIC,
    ...(capApplied !== undefined ? { capApplied } : {}),
    deductions,
    metrics: {
      repoSizeMb: round2(bytes / MB),
      gitBranches: gitRes.branches,
      prodDependencies: bundle.depCount,
      bundleGzipKb: bundle.gzipKb,
      scalingRatio240Over24: scaling.shortRatio,
      scalingRatio: scaling.longRatio,
      p95Tier1Ms: scaling.p95Ms,
      planCacheSpeedup: lru.speedup,
      avgTier1Ms: scaling.avgMs,
    },
  };
}
