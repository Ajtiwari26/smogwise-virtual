import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import { clamp, makeDeduction, round2, runShellCapture } from '../utils.js';

const MAX_SCORE = 4.0;
const TEST_SUBDIRS = ['unit', 'integration', 'security', 'a11y'] as const;

interface VitestJsonReport {
  readonly numFailedTests?: number;
  readonly numPendingTests?: number;
  readonly numTodoTests?: number;
  readonly numPassedTests?: number;
  readonly success?: boolean;
}

interface CoverageMetric {
  readonly pct?: number;
}

interface CoverageFileEntry {
  readonly lines?: CoverageMetric;
  readonly statements?: CoverageMetric;
}

async function walkTestDir(dirPath: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const found: string[] = [];
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        found.push(...(await walkTestDir(full)));
      } else if (/\.test\.tsx?$/.test(entry.name)) {
        found.push(full);
      }
    }
    return found;
  } catch {
    return [];
  }
}

async function discoverAppTests(rootDir: string): Promise<readonly string[]> {
  const all: string[] = [];
  for (const sub of TEST_SUBDIRS) {
    const target = join(rootDir, 'testscript', sub);
    all.push(...(await walkTestDir(target)));
  }
  return all;
}

function extractVitestReport(rawJson: string): VitestJsonReport | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (typeof parsed === 'object' && parsed !== null && 'numPassedTests' in parsed) {
      return parsed as VitestJsonReport;
    }
  } catch {
    return null;
  }
  return null;
}

function parseVitestJson(raw: string): VitestJsonReport | null {
  const whole = extractVitestReport(raw.trim());
  if (whole !== null) return whole;
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = (lines[i] ?? '').trim();
    if (!line.startsWith('{')) continue;
    const report = extractVitestReport(line);
    if (report !== null) return report;
  }
  return null;
}

async function readVitestReport(rootDir: string, stdout: string): Promise<VitestJsonReport | null> {
  const fromStdout = parseVitestJson(stdout);
  if (fromStdout !== null) return fromStdout;
  try {
    const fileRaw = await readFile(join(rootDir, '.vitest', 'json', 'output.json'), 'utf8');
    return parseVitestJson(fileRaw);
  } catch {
    return null;
  }
}

async function checkDomainCoverage(rootDir: string): Promise<readonly DeductionItem[]> {
  const covPath = join(rootDir, 'coverage', 'coverage-summary.json');
  let raw: string;
  try {
    raw = await readFile(covPath, 'utf8');
  } catch {
    return [];
  }
  const parsed = JSON.parse(raw) as Record<string, CoverageFileEntry>;
  const domainEntries = Object.entries(parsed).filter(([k]) =>
    k.replace(/\\/g, '/').includes('src/domain/'),
  );
  if (domainEntries.length === 0) return [];
  const lowFiles = domainEntries.filter(([, entry]) => {
    const pct = entry.lines?.pct ?? entry.statements?.pct ?? 100;
    return pct < 90;
  });
  if (lowFiles.length === 0) return [];
  const msg = `${lowFiles.length} src/domain/ file(s) below 90% coverage`;
  return [makeDeduction('testing', 1.0, msg, 'coverage/coverage-summary.json')];
}

function buildEmptyTestResult(): AnalyzerResult {
  const msg = 'No app test files found under testscript/{unit,integration,security,a11y}';
  return {
    criterion: 'testing',
    deterministicScore: 0.0,
    maxDeterministic: MAX_SCORE,
    deductions: [makeDeduction('testing', MAX_SCORE, msg, 'testscript/')],
    metrics: { discoveredTests: 0 },
  };
}

function buildFailedTestResult(discovered: number, failed: number): AnalyzerResult {
  const msg = `Vitest run failed (${failed} failing test(s))`;
  return {
    criterion: 'testing',
    deterministicScore: 0.0,
    maxDeterministic: MAX_SCORE,
    capApplied: 0.0,
    deductions: [makeDeduction('testing', MAX_SCORE, msg, 'vitest')],
    metrics: { discoveredTests: discovered, failedTests: failed },
  };
}

async function buildPassingTestResult(
  rootDir: string,
  discovered: number,
  report: VitestJsonReport | null,
): Promise<AnalyzerResult> {
  const skipped = (report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0);
  const deductions: DeductionItem[] = [];
  if (skipped > 0) {
    deductions.push(makeDeduction('testing', 1.0, `${skipped} skipped/todo test(s)`, 'vitest'));
  }
  deductions.push(...(await checkDomainCoverage(rootDir)));
  const deducted = deductions.reduce((sum, d) => sum + d.points, 0);
  return {
    criterion: 'testing',
    deterministicScore: clamp(round2(MAX_SCORE - deducted), 0, MAX_SCORE),
    maxDeterministic: MAX_SCORE,
    deductions,
    metrics: {
      discoveredTests: discovered,
      passedTests: report?.numPassedTests ?? 0,
      skippedTests: skipped,
    },
  };
}

export async function runTestingAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const testFiles = await discoverAppTests(rootDir);
  if (testFiles.length === 0) return buildEmptyTestResult();
  const vitestBin = join(rootDir, 'node_modules', '.bin', 'vitest');
  const res = await runShellCapture(vitestBin, ['run', '--reporter=json', '--coverage'], rootDir);
  const report = await readVitestReport(rootDir, res.stdout);
  const failed = report?.numFailedTests ?? (res.code === 0 ? 0 : 1);
  if (failed > 0 || res.code !== 0) {
    return buildFailedTestResult(testFiles.length, failed);
  }
  return buildPassingTestResult(rootDir, testFiles.length, report);
}
