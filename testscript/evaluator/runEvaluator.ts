/**
 * CLI entrypoint and programmatic runner for the SmogWise Virtual hybrid evaluator.
 */

import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { runAiJudge } from './aiJudge.js';
import { runAccessibilityAnalyzer } from './analyzers/accessibilityAnalyzer.js';
import { runAlignmentRuntimeAnalyzer } from './analyzers/alignmentRuntimeAnalyzer.js';
import { runCodeQualityAnalyzer } from './analyzers/codeQualityAnalyzer.js';
import { runEfficiencyAnalyzer } from './analyzers/efficiencyAnalyzer.js';
import { runSecurityAnalyzer } from './analyzers/securityAnalyzer.js';
import { runTestingAnalyzer } from './analyzers/testingAnalyzer.js';
import type {
  AIJudgeResult,
  AIJudgeScores,
  AnalyzerResult,
  CriterionFinalScore,
  CriterionKey,
  DeductionItem,
  EvaluationReport,
  ImpactLevel,
} from './types.js';
import { clamp, isMainModule, round2 } from './utils.js';

interface CriterionMeta {
  readonly key: CriterionKey;
  readonly label: string;
  readonly impact: ImpactLevel;
  readonly maxDeterministic: number;
  readonly maxAi: number;
  readonly aiKey: keyof AIJudgeScores;
}

const CRITERIA_META: readonly CriterionMeta[] = [
  {
    key: 'alignment',
    label: 'Alignment & Impact',
    impact: 'High Impact',
    maxDeterministic: 12,
    maxAi: 18,
    aiKey: 'alignment_ai',
  },
  {
    key: 'codeQuality',
    label: 'Code Quality',
    impact: 'High Impact',
    maxDeterministic: 20,
    maxAi: 10,
    aiKey: 'codeQuality_ai',
  },
  {
    key: 'security',
    label: 'Security & Safety',
    impact: 'Medium Impact',
    maxDeterministic: 11,
    maxAi: 4,
    aiKey: 'security_ai',
  },
  {
    key: 'efficiency',
    label: 'Efficiency & Footprint',
    impact: 'Medium Impact',
    maxDeterministic: 12,
    maxAi: 3,
    aiKey: 'efficiency_ai',
  },
  {
    key: 'testing',
    label: 'Testing & Reliability',
    impact: 'Low Impact',
    maxDeterministic: 4,
    maxAi: 1,
    aiKey: 'testing_ai',
  },
  {
    key: 'accessibility',
    label: 'Accessibility (WCAG)',
    impact: 'Low Impact',
    maxDeterministic: 3.5,
    maxAi: 1.5,
    aiKey: 'accessibility_ai',
  },
];

/** Maps a 0-100 total evaluation score to its rubric band label. */
export function computeBand(score: number): string {
  if (score >= 97) {
    return 'Exceptional (97-100)';
  }
  if (score >= 88) {
    return 'Production Strong (88-96.99)';
  }
  if (score >= 80) {
    return 'Decent (80-87.99)';
  }
  if (score >= 65) {
    return 'Mediocre (65-79.99)';
  }
  return 'Failing (<65)';
}

function buildCriterionScore(
  meta: CriterionMeta,
  detMap: ReadonlyMap<CriterionKey, AnalyzerResult>,
  aiResult: AIJudgeResult,
): CriterionFinalScore {
  const det = detMap.get(meta.key);
  const detScore = round2(det ? det.deterministicScore : 0);
  const aiScore = round2(clamp(aiResult.scores[meta.aiKey], 0, meta.maxAi));
  const maxTotal = round2(meta.maxDeterministic + meta.maxAi);
  const cap = det?.capApplied ?? maxTotal;
  const finalScore = round2(Math.min(detScore + aiScore, cap));
  const detDeds = det ? det.deductions : [];
  const aiDeds = aiResult.deductions.filter((d) => d.criterion === meta.key);
  return {
    criterion: meta.key,
    label: meta.label,
    impact: meta.impact,
    deterministicScore: detScore,
    maxDeterministic: meta.maxDeterministic,
    aiScore,
    maxAi: meta.maxAi,
    finalScore,
    maxTotal,
    deductions: [...detDeds, ...aiDeds],
  };
}

/** Builds a combined 100-point EvaluationReport from deterministic and AI judge scores. */
export function buildReport(
  detResults: readonly AnalyzerResult[],
  aiResult: AIJudgeResult,
): EvaluationReport {
  const detMap = new Map<CriterionKey, AnalyzerResult>();
  for (const res of detResults) {
    detMap.set(res.criterion, res);
  }
  const criteria = CRITERIA_META.map((m) => buildCriterionScore(m, detMap, aiResult));
  const totalScore = round2(
    clamp(criteria.reduce((sum, c) => sum + c.finalScore, 0), 0, 100),
  );
  const hardFailTriggered = detResults.some((r) => r.capApplied !== undefined);
  const allDeductions: DeductionItem[] = criteria
    .flatMap((c) => c.deductions)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  return {
    timestamp: new Date().toISOString(),
    totalScore,
    maxScore: 100,
    band: computeBand(totalScore),
    hardFailTriggered,
    criteria,
    allDeductions,
    aiVerdict: `${aiResult.mode} [${aiResult.modelsUsed.join(', ')}]: ${aiResult.verdict}`,
  };
}

function formatScoreRow(c: CriterionFinalScore): string {
  const name = c.label.padEnd(23);
  const det = `${c.deterministicScore.toFixed(2)}/${c.maxDeterministic.toFixed(2)}`.padStart(12);
  const ai = `${c.aiScore.toFixed(2)}/${c.maxAi.toFixed(2)}`.padStart(11);
  const fin = `${c.finalScore.toFixed(2)}/${c.maxTotal.toFixed(2)}`.padStart(12);
  return `| ${name} | ${det} | ${ai} | ${fin} |`;
}

function printConsoleReport(report: EvaluationReport): void {
  const bar = '='.repeat(71);
  console.log(bar);
  console.log(`SMOGWISE VIRTUAL AUDIT — ${report.totalScore.toFixed(2)} / 100.00 (${report.band})`);
  console.log(bar);
  console.log('| Criterion               | Deterministic |       AI    |       Final |');
  console.log('|-------------------------|--------------|-------------|--------------|');
  for (const c of report.criteria) {
    console.log(formatScoreRow(c));
  }
  console.log(bar);
  console.log(`AI Verdict: ${report.aiVerdict}`);
  console.log(`Hard-Fail Cap Triggered: ${report.hardFailTriggered ? 'YES' : 'NO'}`);
  const topDeds = report.allDeductions.slice(0, 10);
  if (topDeds.length > 0) {
    console.log('\nTop Deductions:');
    for (const d of topDeds) {
      console.log(`- [${d.criterion}] -${Math.abs(d.points).toFixed(2)} pts: ${d.evidence}`);
    }
  }
}

/** Formats an EvaluationReport into a human-readable Markdown audit summary. */
export function formatMarkdownReport(report: EvaluationReport): string {
  const lines: string[] = [
    '# SmogWise Virtual — Evaluation Audit Report',
    '',
    `- **Timestamp:** ${report.timestamp}`,
    `- **Total Score:** **${report.totalScore.toFixed(2)} / 100.00**`,
    `- **Band:** ${report.band}`,
    `- **Hard-Fail Cap Triggered:** ${report.hardFailTriggered ? 'Yes' : 'No'}`,
    `- **AI Verdict:** ${report.aiVerdict}`,
    '',
    '| Criterion | Impact | Deterministic | AI Judge | Final |',
    '| :--- | :--- | ---: | ---: | ---: |',
  ];
  for (const c of report.criteria) {
    lines.push(
      `| ${c.label} | ${c.impact} | ${c.deterministicScore.toFixed(2)}/${c.maxDeterministic.toFixed(2)} | ` +
        `${c.aiScore.toFixed(2)}/${c.maxAi.toFixed(2)} | ${c.finalScore.toFixed(2)}/${c.maxTotal.toFixed(2)} |`,
    );
  }
  lines.push('', '## Deductions', '');
  if (report.allDeductions.length === 0) {
    lines.push('No deductions recorded.');
  } else {
    for (const d of report.allDeductions) {
      lines.push(
        `- **[${d.criterion}] -${Math.abs(d.points).toFixed(2)} pts:** ${d.evidence} _(Fix: ${d.fix})_`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function writeReportFiles(rootDir: string, report: EvaluationReport): void {
  const reportsDir = path.join(rootDir, 'testscript', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, 'latest_audit.json');
  const mdPath = path.join(reportsDir, 'latest_audit.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(mdPath, formatMarkdownReport(report), 'utf8');
}

async function runAllAnalyzers(rootDir: string): Promise<readonly AnalyzerResult[]> {
  return Promise.all([
    runAlignmentRuntimeAnalyzer(rootDir),
    runCodeQualityAnalyzer(rootDir),
    runSecurityAnalyzer(rootDir),
    runEfficiencyAnalyzer(rootDir),
    runTestingAnalyzer(rootDir),
    runAccessibilityAnalyzer(rootDir),
  ]);
}

/** Runs all 6 deterministic analyzers plus the AI judge and persists latest audit reports. */
export async function runEvaluator(rootDir = process.cwd()): Promise<EvaluationReport> {
  dotenv.config({ override: true });
  const deterministicResults = await runAllAnalyzers(rootDir);
  const aiResult = await runAiJudge(rootDir, deterministicResults);
  const report = buildReport(deterministicResults, aiResult);
  writeReportFiles(rootDir, report);
  printConsoleReport(report);
  return report;
}

if (isMainModule(import.meta.url)) {
  runEvaluator().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Evaluator failed: ${msg}`);
    process.exitCode = 1;
  });
}
