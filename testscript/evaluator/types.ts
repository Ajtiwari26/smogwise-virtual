/**
 * Core type definitions for the SmogWise Virtual hybrid evaluator.
 */

export type CriterionKey =
  | 'alignment'
  | 'codeQuality'
  | 'security'
  | 'efficiency'
  | 'testing'
  | 'accessibility';

export type ImpactLevel = 'High Impact' | 'Medium Impact' | 'Low Impact';

export type JudgeMode = 'live_ai_judge' | 'offline_cold_rubric';

export interface DeductionItem {
  readonly criterion: CriterionKey;
  readonly points: number;
  readonly evidence: string;
  readonly fix: string;
}

export interface AnalyzerResult {
  readonly criterion: CriterionKey;
  readonly deterministicScore: number;
  readonly maxDeterministic: number;
  readonly capApplied?: number;
  readonly deductions: readonly DeductionItem[];
  readonly metrics: Readonly<Record<string, string | number | boolean>>;
}

export interface AIJudgeScores {
  readonly alignment_ai: number;
  readonly codeQuality_ai: number;
  readonly security_ai: number;
  readonly efficiency_ai: number;
  readonly testing_ai: number;
  readonly accessibility_ai: number;
}

export interface AIJudgeResult {
  readonly mode: JudgeMode;
  readonly modelsUsed: readonly string[];
  readonly scores: AIJudgeScores;
  readonly deductions: readonly DeductionItem[];
  readonly verdict: string;
}

export interface CriterionFinalScore {
  readonly criterion: CriterionKey;
  readonly label: string;
  readonly impact: ImpactLevel;
  readonly deterministicScore: number;
  readonly maxDeterministic: number;
  readonly aiScore: number;
  readonly maxAi: number;
  readonly finalScore: number;
  readonly maxTotal: number;
  readonly deductions: readonly DeductionItem[];
}

export interface EvaluationReport {
  readonly timestamp: string;
  readonly totalScore: number;
  readonly maxScore: number;
  readonly band: string;
  readonly hardFailTriggered: boolean;
  readonly criteria: readonly CriterionFinalScore[];
  readonly allDeductions: readonly DeductionItem[];
  readonly aiVerdict: string;
}
