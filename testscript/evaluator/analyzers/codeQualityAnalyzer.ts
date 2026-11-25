import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import {
  clamp,
  listSourceFiles,
  makeDeduction,
  round2,
  runShellCapture,
} from '../utils.js';

const MAX_SCORE = 20.0;
const TYPE_ESCAPE_CAP = 18.0;

interface CapCheckResult {
  readonly deductions: readonly DeductionItem[];
  readonly capped: boolean;
}

interface EslintEntry {
  readonly errorCount?: number;
  readonly warningCount?: number;
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
  if (web.code === 0 && srv.code === 0) {
    return { deductions: [], capped: false };
  }
  const detail = web.code !== 0 ? 'tsconfig.json' : 'tsconfig.server.json';
  return {
    deductions: [makeDeduction('codeQuality', 6.0, `TypeScript check failed (${detail})`, detail)],
    capped: true,
  };
}

async function checkTypeEscapes(
  rootDir: string,
  files: readonly string[],
): Promise<CapCheckResult> {
  const patterns = buildEscapePatterns();
  const deductions: DeductionItem[] = [];
  for (const file of files) {
    if (file.endsWith('codeQualityAnalyzer.ts')) continue;
    const content = await readFile(file, 'utf8');
    const rel = relative(rootDir, file);
    for (const pat of patterns) {
      const matches = content.match(pat.regex);
      if (matches && matches.length > 0) {
        const pts = round2(matches.length * 2.0);
        deductions.push(makeDeduction('codeQuality', pts, `${pat.label} in ${rel}`, rel));
      }
    }
  }
  return { deductions, capped: deductions.length > 0 };
}

function parseEslintJson(raw: string): readonly EslintEntry[] {
  const start = raw.indexOf('[');
  if (start < 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw.slice(start));
    return Array.isArray(parsed) ? (parsed as readonly EslintEntry[]) : [];
  } catch {
    return [];
  }
}

async function checkEslint(rootDir: string): Promise<readonly DeductionItem[]> {
  const bin = join(rootDir, 'node_modules', '.bin', 'eslint');
  const res = await runShellCapture(bin, ['.', '--format', 'json'], rootDir);
  const entries = parseEslintJson(res.stdout);
  let errors = 0;
  let warnings = 0;
  for (const entry of entries) {
    errors += entry.errorCount ?? 0;
    warnings += entry.warningCount ?? 0;
  }
  const deductions: DeductionItem[] = [];
  if (errors > 0) {
    const pts = round2(errors * 1.5);
    deductions.push(makeDeduction('codeQuality', pts, `ESLint errors: ${errors}`, 'eslint'));
  }
  if (warnings > 0) {
    const pts = round2(warnings * 0.5);
    deductions.push(makeDeduction('codeQuality', pts, `ESLint warnings: ${warnings}`, 'eslint'));
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

function isForbiddenImport(spec: string, forbidden: readonly string[]): boolean {
  return forbidden.some((prefix) => spec === prefix || spec.startsWith(prefix));
}

async function checkBoundaries(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const domainForbidden = ['react', 'react-dom', 'node:', 'express', '@google/genai'];
  const clientForbidden = ['@google/genai', 'dotenv'];
  const deductions: DeductionItem[] = [];
  for (const file of files) {
    const rel = relative(rootDir, file).replace(/\\/g, '/');
    const isDomain = rel.startsWith('src/domain/');
    const isClient = rel.startsWith('src/') && !isDomain;
    if (!isDomain && !isClient) continue;
    const specs = extractImportSpecifiers(await readFile(file, 'utf8'));
    const banned = isDomain ? domainForbidden : clientForbidden;
    for (const spec of specs) {
      if (isForbiddenImport(spec, banned)) {
        deductions.push(makeDeduction('codeQuality', 1.5, `Boundary violation: ${spec}`, rel));
      }
    }
  }
  return deductions;
}

function countMissingJsDoc(content: string): number {
  const lines = content.split('\n');
  let missing = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim() ?? '';
    if (!/^export\s+(?:async\s+)?function\s+/.test(line)) continue;
    const prev = lines.slice(Math.max(0, i - 6), i).join('\n');
    if (!prev.includes('/**')) missing += 1;
  }
  return missing;
}

async function checkJsDoc(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const targets = files.filter((f) => {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    return rel.startsWith('src/domain/') || rel.startsWith('server/');
  });
  if (targets.length === 0) {
    const msg = 'No src/domain/ or server/ files for JSDoc';
    return [makeDeduction('codeQuality', 2.5, msg, 'src/domain/')];
  }
  let totalMissing = 0;
  for (const file of targets) {
    totalMissing += countMissingJsDoc(await readFile(file, 'utf8'));
  }
  if (totalMissing === 0) return [];
  const pts = round2(Math.min(2.5, totalMissing * 0.4));
  const msg = `Missing JSDoc on ${totalMissing} exported fns`;
  return [makeDeduction('codeQuality', pts, msg, 'src/domain/')];
}

async function checkDry(
  rootDir: string,
  files: readonly string[],
): Promise<readonly DeductionItem[]> {
  const targets = files.filter((f) => {
    const rel = relative(rootDir, f).replace(/\\/g, '/');
    return rel.startsWith('src/') || rel.startsWith('server/');
  });
  if (targets.length === 0) {
    const msg = 'No src/ or server/ files for DRY audit';
    return [makeDeduction('codeQuality', 2.5, msg, 'src/')];
  }
  const seen = new Set<string>();
  let dupes = 0;
  for (const file of targets) {
    const norm = (await readFile(file, 'utf8'))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (let i = 0; i <= norm.length - 12; i += 1) {
      const win = norm.slice(i, i + 12).join('\n');
      if (seen.has(win)) dupes += 1;
      else seen.add(win);
    }
  }
  if (dupes === 0) return [];
  const pts = round2(Math.min(2.5, dupes * 0.5));
  const msg = `Detected ${dupes} duplicate 12-line blocks`;
  return [makeDeduction('codeQuality', pts, msg, 'src/')];
}

export async function runCodeQualityAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const files = await listSourceFiles(rootDir);
  const tscRes = await checkTypeScript(rootDir);
  const escapeRes = await checkTypeEscapes(rootDir, files);
  const eslintDeds = await checkEslint(rootDir);
  const boundaryDeds = await checkBoundaries(rootDir, files);
  const jsDocDeds = await checkJsDoc(rootDir, files);
  const dryDeds = await checkDry(rootDir, files);
  const deductions: readonly DeductionItem[] = [
    ...tscRes.deductions,
    ...escapeRes.deductions,
    ...eslintDeds,
    ...boundaryDeds,
    ...jsDocDeds,
    ...dryDeds,
  ];
  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const capped = tscRes.capped || escapeRes.capped;
  const rawScore = clamp(round2(MAX_SCORE - totalDeducted), 0, MAX_SCORE);
  const deterministicScore = capped ? Math.min(rawScore, TYPE_ESCAPE_CAP) : rawScore;
  return {
    criterion: 'codeQuality',
    deterministicScore,
    maxDeterministic: MAX_SCORE,
    deductions,
    metrics: {
      scannedFiles: files.length,
      deductionCount: deductions.length,
    },
    ...(capped ? { capApplied: TYPE_ESCAPE_CAP } : {}),
  };
}
