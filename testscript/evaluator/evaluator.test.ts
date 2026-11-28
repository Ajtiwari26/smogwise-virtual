import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkColorAndTypography } from './analyzers/accessibilityContrast.js';
import { checkTier1Scaling } from './analyzers/efficiencyScaling.js';
import { runSecurityAnalyzer } from './analyzers/securityAnalyzer.js';
import { checkDomainCoverage } from './analyzers/testingAnalyzer.js';
import {
  averageScores,
  buildColdFallback,
  mergeDeductions,
  parseJudgeJson,
} from './judgePrompts.js';
import { buildReport, computeBand, formatMarkdownReport } from './runEvaluator.js';
import type { AnalyzerResult, DeductionItem } from './types.js';
import { makeDeduction } from './utils.js';
import * as utils from './utils.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'smogwise-eval-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('evaluator reporting & deduction sorting', () => {
  it('maps bands and sorts deductions by magnitude even with negative points', () => {
    expect(computeBand(98.5)).toBe('Exceptional (97-100)');
    expect(computeBand(91.2)).toBe('Production Strong (88-96.99)');
    expect(computeBand(83.0)).toBe('Decent (80-87.99)');
    expect(computeBand(70.0)).toBe('Mediocre (65-79.99)');
    expect(computeBand(40.0)).toBe('Failing (<65)');

    const detResults: readonly AnalyzerResult[] = [
      {
        criterion: 'alignment',
        deterministicScore: 11,
        maxDeterministic: 12,
        deductions: [makeDeduction('alignment', 1.0, 'Minor lag', 'cache')],
        metrics: {},
      },
      {
        criterion: 'codeQuality',
        deterministicScore: 17,
        maxDeterministic: 20,
        deductions: [makeDeduction('codeQuality', -3.0, 'Type escape', 'fix')],
        metrics: {},
      },
    ];
    const aiResult = buildColdFallback(detResults, 5);
    const report = buildReport(detResults, aiResult);

    expect(report.allDeductions[0]?.points).toBe(3.6);
    expect(report.allDeductions[1]?.points).toBe(-3);
    const md = formatMarkdownReport(report);
    expect(md).toContain('-3.00 pts');
    expect(md).not.toContain('--3.00');
  });

  it('joins SDK model output fragments and distinguishes failed configured AI judge', () => {
    expect(
      utils.extractInteractionText({
        status: 'completed',
        steps: [{ type: 'model_output', content: [
          { type: 'text', text: 'First block ' },
          { type: 'text', text: 'Second block' },
        ] }],
      }),
    ).toBe('First block Second block');

    const detResults: readonly AnalyzerResult[] = [
      {
        criterion: 'alignment',
        deterministicScore: 12,
        maxDeterministic: 12,
        deductions: [],
        metrics: {},
      },
    ];
    const configuredFail = buildColdFallback(detResults, 5, true);
    expect(configuredFail.deductions[0]?.evidence).toContain('request failed or timed out');
    expect(configuredFail.deductions[0]?.evidence).not.toContain('no live AI judge keys');
  });
});

describe('testingAnalyzer checkDomainCoverage', () => {
  it('deducts when coverage-summary.json is missing and flags low branch coverage', async () => {
    const missingDir = makeTempDir();
    const missingDeds = await checkDomainCoverage(missingDir);
    expect(missingDeds).toHaveLength(1);
    expect(missingDeds[0]?.evidence).toContain('missing');

    const lowDir = makeTempDir();
    mkdirSync(join(lowDir, 'coverage'), { recursive: true });
    writeFileSync(
      join(lowDir, 'coverage', 'coverage-summary.json'),
      JSON.stringify({
        total: { branches: { pct: 70 }, lines: { pct: 95 }, statements: { pct: 95 } },
        '/app/src/domain/example.ts': {
          branches: { pct: 72 },
          lines: { pct: 85 },
          statements: { pct: 85 },
        },
      }),
    );
    const lowDeds = await checkDomainCoverage(lowDir);
    expect(lowDeds.length).toBe(2);

    const missingMetricDir = makeTempDir();
    mkdirSync(join(missingMetricDir, 'coverage'), { recursive: true });
    writeFileSync(join(missingMetricDir, 'coverage', 'coverage-summary.json'), JSON.stringify({ total: {} }));
    const missingMetricDeds = await checkDomainCoverage(missingMetricDir);
    expect(missingMetricDeds).toHaveLength(1);
    expect(missingMetricDeds[0]?.evidence).toContain('0%');
  });
});

function buildJudgeJsonSample(alignmentAi: number, codeQualityAi: number, dedPts: number): string {
  return JSON.stringify({
    scores: {
      alignment_ai: alignmentAi,
      codeQuality_ai: codeQualityAi,
      security_ai: 4,
      efficiency_ai: 3,
      testing_ai: 1,
      accessibility_ai: 1.5,
    },
    deductions: [
      {
        criterion: 'codeQuality',
        points: dedPts,
        evidence: 'Duplicate helper logic across routes',
        fix: 'Consolidate helper',
      },
    ],
    verdict: 'Verified solid codebase.',
  });
}

describe('judgePrompts & accessibilityContrast', () => {
  it('validates parseJudgeJson, clamps averaged scores, and deduplicates merged deductions', () => {
    expect(parseJudgeJson('')).toBeNull();
    expect(parseJudgeJson('{not-json')).toBeNull();

    const p1 = parseJudgeJson(buildJudgeJsonSample(18, 9, 0.5));
    const p2 = parseJudgeJson(buildJudgeJsonSample(17, 9.5, 0.4));
    expect(p1).not.toBeNull();
    expect(p2).not.toBeNull();
    if (p1 === null || p2 === null) return;

    const avg = averageScores([p1, p2]);
    expect(avg.alignment_ai).toBe(17.5);
    expect(avg.codeQuality_ai).toBe(9.25);
    expect(mergeDeductions([p1, p2])).toHaveLength(1);
  });

  it('detects sub-12px typography and missing high-contrast control borders', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.css'), 'body { color: #0f172a; background: #ffffff; }');
    writeFileSync(join(dir, 'tailwind.config.ts'), 'export default {};');
    const deds: DeductionItem[] = [];
    const summary = checkColorAndTypography(dir, '<span className="text-[11px] border-slate-300" />', deds);
    expect(summary.passed).toBe(true);
    expect(deds.some((d) => d.evidence.includes('Sub-12px'))).toBe(true);
    expect(deds.some((d) => d.evidence.includes('border-slate-500'))).toBe(true);

    const singleColorDir = makeTempDir();
    mkdirSync(join(singleColorDir, 'src'), { recursive: true });
    writeFileSync(join(singleColorDir, 'src', 'index.css'), 'body { color: #0f172a; }');
    writeFileSync(join(singleColorDir, 'tailwind.config.ts'), 'export default {};');
    const singleDeds: DeductionItem[] = [];
    const singleSummary = checkColorAndTypography(
      singleColorDir,
      '<div className="border-slate-500" />',
      singleDeds,
    );
    expect(singleSummary.passed).toBe(false);
    expect(singleDeds.some((d) => d.evidence.includes('contrast'))).toBe(true);
  });
});

function auditReport(high: number): string {
  return JSON.stringify({
    auditReportVersion: 2,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high, critical: 0, total: high },
    },
  });
}

describe('security analyzer npm audit', () => {
  it.each([
    { code: 0, output: auditReport(0), high: 0, deduction: 0 },
    { code: 1, output: auditReport(2), high: 2, deduction: 1.5 },
    { code: 0, output: '{broken JSON', high: 'unverified', deduction: 3 },
    { code: 0, output: '{"metadata":{}}', high: 'unverified', deduction: 3 },
    { code: 1, output: auditReport(0), high: 'unverified', deduction: 3 },
    { code: 2, output: auditReport(2), high: 'unverified', deduction: 3 },
    { code: -1, output: auditReport(2), high: 'unverified', deduction: 3 },
  ])('scores exit $code and output $output', async ({ code, output, high, deduction }) => {
    vi.spyOn(utils, 'runShellCapture').mockResolvedValue({ code, stdout: output, stderr: '' });
    const result = await runSecurityAnalyzer(makeTempDir());
    expect(result.metrics['auditHigh']).toBe(high);
    expect(result.metrics['staticDeduction']).toBe(deduction);
  });
});

describe('efficiency analyzer scaling', () => {
  it('benchmarks the solver with 24, 240, and 2400 input steps', async () => {
    const measuredSteps = new Set<number>();
    const compute = vi.fn();
    vi.spyOn(utils, 'safeDynamicImport').mockImplementation(async (modulePath) =>
      modulePath.endsWith('exposureEngine.ts')
        ? { computeIndoorSeries: (outdoor: readonly number[]) => measuredSteps.add(outdoor.length) }
        : { computeDeterministicReport: compute },
    );
    const deductions: DeductionItem[] = [];
    const result = await checkTier1Scaling(makeTempDir(), deductions);

    expect(measuredSteps).toEqual(new Set([24, 240, 2400]));
    expect(compute).toHaveBeenCalled();
    expect(result.p95Ms).toBeGreaterThanOrEqual(0);
  });
});
