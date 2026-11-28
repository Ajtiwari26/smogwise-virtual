/**
 * Deterministic code-quality analyzer enforcing strict TypeScript, ESLint,
 * architectural boundaries, type safety, non-empty catches, JSDoc, and DRY.
 */

import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { scoreSourceQuality } from './sourceQuality.js';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import {
  clamp,
  isPlainRecord,
  listSourceFiles,
  makeDeduction,
  readFileSafe,
  round2,
  runShellCapture,
} from '../utils.js';

const MAX_SCORE = 20.0;
const TYPE_ESCAPE_CAP = 18.0;
const STRICT_TS_FLAGS = ['noUnusedLocals', 'noUnusedParameters', 'noImplicitReturns'] as const;

interface CapCheckResult {
  readonly deductions: readonly DeductionItem[];
  readonly capped: boolean;
}

async function checkTypeScript(rootDir: string): Promise<CapCheckResult> {
  const check = await runShellCapture('npm', ['run', 'typecheck'], rootDir);
  const deductions: DeductionItem[] = [];
  if (check.code !== 0) {
    deductions.push(makeDeduction('codeQuality', 6.0, 'TypeScript check failed', 'npm run typecheck'));
  }
  const raw = readFileSafe(join(rootDir, 'tsconfig.json'));
  const config: unknown = ts.parseConfigFileTextToJson('tsconfig.json', raw).config;
  const options = isPlainRecord(config) ? config['compilerOptions'] : undefined;
  const missingFlags = STRICT_TS_FLAGS.filter((flag) =>
    !isPlainRecord(options) || options[flag] !== true,
  );
  if (missingFlags.length > 0) {
    deductions.push(makeDeduction(
      'codeQuality', round2(missingFlags.length * 0.25),
      `tsconfig.json missing strict compiler flags: ${missingFlags.join(', ')}`, 'tsconfig.json',
    ));
  }
  return { deductions, capped: check.code !== 0 };
}

function tallyEslintEntries(
  raw: string,
): { readonly errors: number; readonly warnings: number; readonly valid: boolean } {
  const start = raw.indexOf('[');
  if (start < 0) return { errors: 0, warnings: 0, valid: false };
  try {
    const parsed: unknown = JSON.parse(raw.slice(start));
    if (!Array.isArray(parsed)) return { errors: 0, warnings: 0, valid: false };
    let errors = 0;
    let warnings = 0;
    for (const entry of parsed) {
      if (isPlainRecord(entry)) {
        errors += typeof entry['errorCount'] === 'number' ? entry['errorCount'] : 0;
        warnings += typeof entry['warningCount'] === 'number' ? entry['warningCount'] : 0;
      }
    }
    return { errors, warnings, valid: true };
  } catch (err: unknown) {
    void err;
    return { errors: 0, warnings: 0, valid: false };
  }
}

async function checkEslint(rootDir: string): Promise<readonly DeductionItem[]> {
  const bin = join(rootDir, 'node_modules', '.bin', 'eslint');
  const res = await runShellCapture(bin, ['.', '--format', 'json'], rootDir);
  const { errors, warnings, valid } = tallyEslintEntries(res.stdout);
  const deductions: DeductionItem[] = [];
  if (!valid || (res.code !== 0 && errors === 0 && warnings === 0)) {
    deductions.push(
      makeDeduction('codeQuality', 15, 'ESLint execution failed without valid report', 'eslint'),
    );
    return deductions;
  }
  if (errors > 0) {
    deductions.push(makeDeduction('codeQuality', round2(errors * 1.5), `ESLint errors: ${errors}`, 'eslint'));
  }
  if (warnings > 0) {
    deductions.push(
      makeDeduction('codeQuality', round2(warnings * 0.5), `ESLint warnings: ${warnings}`, 'eslint'),
    );
  }
  return deductions;
}

async function checkSource(rootDir: string, files: readonly string[]): Promise<CapCheckResult> {
  const deductions: DeductionItem[] = [];
  let capped = false;
  let missingDocs = 0;
  let scanned = 0;
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    if (!/^(?:src|server|api|testscript\/evaluator)\//.test(rel)) continue;
    if (/\.test\.[jt]sx?$/.test(rel)) continue;
    const result = scoreSourceQuality(rel, await readFile(file, 'utf8'));
    deductions.push(...result.deductions);
    capped ||= result.capped;
    missingDocs += result.missingDocs;
    scanned += 1;
  }
  if (scanned === 0 || missingDocs > 0) {
    const detail = scanned === 0 ? 'No source files to inspect' : `Missing JSDoc on ${missingDocs} exports`;
    const count = scanned === 0 ? 7 : missingDocs;
    deductions.push(makeDeduction('codeQuality', Math.min(2.5, count * 0.4), detail, 'src/'));
  }
  return { deductions, capped };
}

async function checkDry(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const targets = files.filter((f) => {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    return rel.startsWith('src/') || rel.startsWith('server/')
      || rel.startsWith('testscript/evaluator/');
  });
  if (targets.length === 0) {
    return [makeDeduction('codeQuality', 2.5, 'No src/ or server/ files for DRY audit', 'src/')];
  }
  const seen = new Set<string>();
  let dupes = 0;
  for (const file of targets) {
    const norm = (await readFile(file, 'utf8')).split('\n').map((l) => l.trim()).filter(Boolean);
    for (let i = 0; i <= norm.length - 12; i += 1) {
      const win = norm.slice(i, i + 12).join('\n');
      if (seen.has(win)) dupes += 1; else seen.add(win);
    }
  }
  const msg = `Text heuristic found ${dupes} repeated 12-line blocks`;
  return dupes === 0 ? [] : [makeDeduction('codeQuality', round2(Math.min(2.5, dupes * 0.5)), msg, 'src/')];
}

/** Runs deterministic code quality checks across TypeScript, ESLint, boundaries, JSDoc, and DRY. */
export async function runCodeQualityAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const files = listSourceFiles(rootDir);
  const [tscRes, sourceRes, eslintDeds, dryDeds] = await Promise.all([
    checkTypeScript(rootDir),
    checkSource(rootDir, files),
    checkEslint(rootDir),
    checkDry(rootDir, files),
  ]);
  const deductions = [
    ...tscRes.deductions, ...sourceRes.deductions, ...eslintDeds, ...dryDeds,
  ];
  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const capped = tscRes.capped || sourceRes.capped;
  const rawScore = clamp(round2(MAX_SCORE - totalDeducted), 0, MAX_SCORE);
  return {
    criterion: 'codeQuality',
    deterministicScore: capped ? Math.min(rawScore, TYPE_ESCAPE_CAP) : rawScore,
    maxDeterministic: MAX_SCORE,
    deductions,
    metrics: { scannedFiles: files.length, deductionCount: deductions.length },
    ...(capped ? { capApplied: TYPE_ESCAPE_CAP } : {}),
  };
}
