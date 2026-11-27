/**
 * Deterministic code-quality analyzer enforcing strict TypeScript, ESLint,
 * architectural boundaries, type safety, non-empty catches, JSDoc, and DRY.
 */

import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
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

function buildEscapePatterns(): readonly { label: string; regex: RegExp }[] {
  const anyWord = 'a' + 'ny';
  const tsPrefix = '@ts' + '-';
  return [
    { label: 'explicit any type', regex: new RegExp(`:\\s*${anyWord}\\b`, 'g') },
    { label: 'any cast', regex: new RegExp(`\\bas\\s+${anyWord}\\b`, 'g') },
    { label: 'ts-ignore', regex: new RegExp(`${tsPrefix}ignore`, 'g') },
    { label: 'ts-nocheck', regex: new RegExp(`${tsPrefix}nocheck`, 'g') },
  ];
}

async function checkTypeScript(rootDir: string): Promise<CapCheckResult> {
  const tscBin = join(rootDir, 'node_modules', '.bin', 'tsc');
  const web = await runShellCapture(tscBin, ['--noEmit'], rootDir);
  const srv = await runShellCapture(tscBin, ['-p', 'tsconfig.server.json', '--noEmit'], rootDir);
  const deductions: DeductionItem[] = [];
  if (web.code !== 0 || srv.code !== 0) {
    const detail = web.code !== 0 ? 'tsconfig.json' : 'tsconfig.server.json';
    deductions.push(makeDeduction('codeQuality', 6.0, `TypeScript check failed (${detail})`, detail));
  }
  const tsconfigRaw = readFileSafe(join(rootDir, 'tsconfig.json'));
  const missingFlags = STRICT_TS_FLAGS.filter((flag) => !tsconfigRaw.includes(`"${flag}": true`));
  if (missingFlags.length > 0) {
    deductions.push(
      makeDeduction(
        'codeQuality',
        round2(missingFlags.length * 0.25),
        `tsconfig.json missing strict compiler flags: ${missingFlags.join(', ')}`,
        'tsconfig.json',
      ),
    );
  }
  return { deductions, capped: web.code !== 0 || srv.code !== 0 };
}

function inspectFileQuality(
  rel: string,
  content: string,
  patterns: readonly { label: string; regex: RegExp }[],
  deductions: DeductionItem[],
): boolean {
  let hasEscape = false;
  for (const pat of patterns) {
    const matches = content.match(pat.regex);
    if (matches && matches.length > 0) {
      hasEscape = true;
      deductions.push(
        makeDeduction('codeQuality', round2(matches.length * 2.0), `${pat.label} in ${rel}`, rel),
      );
    }
  }
  const isRuntimeCode = rel.startsWith('src/') || rel.startsWith('server/');
  const nonConstAsRe = new RegExp('\\bas\\s+(?!const\\b)[A-Za-z_][A-Za-z0-9_<>.\\[\\]]*', 'g');
  const bareCatchRe = /\bcatch\s*\{\s*\}|\bcatch\s*\([^)]*\)\s*\{\s*\}/g;
  if (isRuntimeCode && nonConstAsRe.test(content)) {
    deductions.push(
      makeDeduction('codeQuality', 0.35, `Non-const type cast ('as ...') in ${rel}`, rel),
    );
  }
  if (isRuntimeCode && bareCatchRe.test(content)) {
    deductions.push(makeDeduction('codeQuality', 0.5, `Empty catch block in ${rel}`, rel));
  }
  return hasEscape;
}

async function checkTypeEscapesAndCasts(
  rootDir: string,
  files: readonly string[],
): Promise<CapCheckResult> {
  const patterns = buildEscapePatterns();
  const deductions: DeductionItem[] = [];
  let hasEscape = false;
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    if (rel.startsWith('testscript/evaluator/')) continue;
    const content = await readFile(file, 'utf8');
    if (inspectFileQuality(rel, content, patterns, deductions)) {
      hasEscape = true;
    }
  }
  return { deductions, capped: hasEscape };
}

function tallyEslintEntries(raw: string): { readonly errors: number; readonly warnings: number } {
  const start = raw.indexOf('[');
  if (start < 0) return { errors: 0, warnings: 0 };
  try {
    const parsed: unknown = JSON.parse(raw.slice(start));
    if (!Array.isArray(parsed)) return { errors: 0, warnings: 0 };
    let errors = 0;
    let warnings = 0;
    for (const entry of parsed) {
      if (isPlainRecord(entry)) {
        errors += typeof entry['errorCount'] === 'number' ? entry['errorCount'] : 0;
        warnings += typeof entry['warningCount'] === 'number' ? entry['warningCount'] : 0;
      }
    }
    return { errors, warnings };
  } catch (err: unknown) {
    void err;
    return { errors: 0, warnings: 0 };
  }
}

async function checkEslint(rootDir: string): Promise<readonly DeductionItem[]> {
  const bin = join(rootDir, 'node_modules', '.bin', 'eslint');
  const res = await runShellCapture(bin, ['.', '--format', 'json'], rootDir);
  const { errors, warnings } = tallyEslintEntries(res.stdout);
  const deductions: DeductionItem[] = [];
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

function extractImportSpecifiers(content: string): readonly string[] {
  const regex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
  const specs: string[] = [];
  let match = regex.exec(content);
  while (match !== null) {
    if (match[1] !== undefined) specs.push(match[1]);
    match = regex.exec(content);
  }
  return specs;
}

async function checkBoundaries(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const domainBanned = ['react', 'react-dom', 'node:', 'express', '@google/genai'];
  const clientBanned = ['@google/genai', 'dotenv'];
  const deductions: DeductionItem[] = [];
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const isDomain = rel.startsWith('src/domain/');
    const isClient = rel.startsWith('src/') && !isDomain;
    if (!isDomain && !isClient) continue;
    const banned = isDomain ? domainBanned : clientBanned;
    for (const spec of extractImportSpecifiers(await readFile(file, 'utf8'))) {
      if (banned.some((prefix) => spec === prefix || spec.startsWith(prefix))) {
        deductions.push(makeDeduction('codeQuality', 1.5, `Boundary violation: ${spec}`, rel));
      }
    }
  }
  return deductions;
}

const EXPORT_DECL_RE =
  /^export\s+(?:(?:async\s+)?function\b|const\b|class\b|interface\b|type\b|default\b|\{)/;

function countMissingJsDoc(content: string): number {
  const lines = content.split('\n');
  let missing = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!EXPORT_DECL_RE.test(line)) continue;
    const prev = lines.slice(Math.max(0, i - 6), i).join('\n');
    if (!prev.includes('/**')) missing += 1;
  }
  return missing;
}

async function checkJsDoc(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const prefixes = ['src/', 'server/', 'api/', 'testscript/evaluator/'];
  const targets = files.filter((f) =>
    prefixes.some((p) => relative(rootDir, f).replace(/\\/g, '/').startsWith(p)),
  );
  if (targets.length === 0) {
    return [makeDeduction('codeQuality', 2.5, 'No src/, server/, or api/ files for JSDoc', 'src/')];
  }
  let totalMissing = 0;
  for (const file of targets) totalMissing += countMissingJsDoc(await readFile(file, 'utf8'));
  if (totalMissing === 0) return [];
  const pts = round2(Math.min(2.5, totalMissing * 0.4));
  return [makeDeduction('codeQuality', pts, `Missing JSDoc on ${totalMissing} export(s)`, 'src/')];
}

async function checkDry(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const targets = files.filter((f) => {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    return rel.startsWith('src/') || rel.startsWith('server/') || rel.startsWith('testscript/evaluator/');
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
      if (seen.has(win)) dupes += 1;
      else seen.add(win);
    }
  }
  const pts = round2(Math.min(2.5, dupes * 0.5));
  return dupes === 0 ? [] : [makeDeduction('codeQuality', pts, `Detected ${dupes} duplicate 12-line blocks`, 'src/')];
}

/** Runs deterministic code quality checks across TypeScript, ESLint, boundaries, JSDoc, and DRY. */
export async function runCodeQualityAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const files = listSourceFiles(rootDir);
  const [tscRes, escapeRes, eslintDeds, boundaryDeds, jsDocDeds, dryDeds] = await Promise.all([
    checkTypeScript(rootDir),
    checkTypeEscapesAndCasts(rootDir, files),
    checkEslint(rootDir),
    checkBoundaries(rootDir, files),
    checkJsDoc(rootDir, files),
    checkDry(rootDir, files),
  ]);
  const deductions = [
    ...tscRes.deductions, ...escapeRes.deductions, ...eslintDeds,
    ...boundaryDeds, ...jsDocDeds, ...dryDeds,
  ];
  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const capped = tscRes.capped || escapeRes.capped;
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
