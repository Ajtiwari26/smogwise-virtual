/**
 * Deterministic testing and coverage reliability analyzer for SmogWise Virtual.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import { clamp, isPlainRecord, makeDeduction, round2, runShellCapture } from '../utils.js';

const MAX_SCORE = 4.0;
const TEST_SUBDIRS = ['unit', 'integration', 'security', 'a11y'] as const;
const MIN_DOMAIN_LINE_PCT = 90;
const MIN_DOMAIN_STMT_PCT = 90;
const MIN_BRANCH_PCT = 85;

interface VitestJsonReport {
  readonly numFailedTests: number;
  readonly numPendingTests: number;
  readonly numTodoTests: number;
  readonly numPassedTests: number;
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
  } catch (err: unknown) {
    void err;
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

function readNum(rec: Record<string, unknown>, key: string): number {
  const val = rec[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function extractVitestReport(rawJson: string): VitestJsonReport | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (!isPlainRecord(parsed) || !('numPassedTests' in parsed)) {
      return null;
    }
    return {
      numFailedTests: readNum(parsed, 'numFailedTests'),
      numPendingTests: readNum(parsed, 'numPendingTests'),
      numTodoTests: readNum(parsed, 'numTodoTests'),
      numPassedTests: readNum(parsed, 'numPassedTests'),
    };
  } catch (err: unknown) {
    void err;
    return null;
  }
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
  } catch (err: unknown) {
    void err;
    return null;
  }
}

function readMetricPct(entry: Record<string, unknown>, key: string): number {
  const metric = entry[key];
  if (isPlainRecord(metric) && typeof metric['pct'] === 'number' && Number.isFinite(metric['pct'])) {
    return metric['pct'];
  }
  return 0;
}

function evaluateCoverageEntries(parsed: Record<string, unknown>): readonly DeductionItem[] {
  const deductions: DeductionItem[] = [];
  const total = parsed['total'];
  if (isPlainRecord(total) && readMetricPct(total, 'branches') < MIN_BRANCH_PCT) {
    deductions.push(
      makeDeduction(
        'testing',
        0.5,
        `Total branch coverage ${readMetricPct(total, 'branches')}% below ${MIN_BRANCH_PCT}%.`,
        'Add tests covering conditional error/fallback branches.',
      ),
    );
  }
  const lowDomainFiles = Object.entries(parsed).filter(([k, val]) => {
    if (!k.replace(/\\/g, '/').includes('src/domain/') || !isPlainRecord(val)) {
      return false;
    }
    return (
      readMetricPct(val, 'lines') < MIN_DOMAIN_LINE_PCT ||
      readMetricPct(val, 'statements') < MIN_DOMAIN_STMT_PCT ||
      readMetricPct(val, 'branches') < MIN_BRANCH_PCT
    );
  });
  if (lowDomainFiles.length > 0) {
    deductions.push(
      makeDeduction(
        'testing',
        1.0,
        `${lowDomainFiles.length} src/domain/ file(s) below 90%/85% line/branch coverage`,
        'coverage/coverage-summary.json',
      ),
    );
  }
  return deductions;
}

/** Verifies generated coverage-summary.json metrics for total branches and src/domain/. */
export async function checkDomainCoverage(rootDir: string): Promise<readonly DeductionItem[]> {
  const covPath = join(rootDir, 'coverage', 'coverage-summary.json');
  try {
    const raw = await readFile(covPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainRecord(parsed)) {
      return [
        makeDeduction(
          'testing',
          0.75,
          'coverage/coverage-summary.json is not a valid JSON object.',
          'Configure vitest json-summary coverage reporter.',
        ),
      ];
    }
    return evaluateCoverageEntries(parsed);
  } catch (err: unknown) {
    void err;
    return [
      makeDeduction(
        'testing',
        0.75,
        'coverage/coverage-summary.json missing or unreadable; coverage unverified.',
        'Run vitest with --coverage.reporter=json-summary.',
      ),
    ];
  }
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

/** Runs Vitest with JSON + json-summary coverage and grades test health and branch coverage. */
export async function runTestingAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const testFiles = await discoverAppTests(rootDir);
  if (testFiles.length === 0) return buildEmptyTestResult();
  const vitestBin = join(rootDir, 'node_modules', '.bin', 'vitest');
  const res = await runShellCapture(
    vitestBin,
    ['run', '--reporter=json', '--coverage', '--coverage.reporter=json-summary'],
    rootDir,
  );
  const report = await readVitestReport(rootDir, res.stdout);
  const failed = report?.numFailedTests ?? (res.code === 0 ? 0 : 1);
  if (failed > 0 || res.code !== 0) {
    return buildFailedTestResult(testFiles.length, failed);
  }
  return buildPassingTestResult(rootDir, testFiles.length, report);
}
