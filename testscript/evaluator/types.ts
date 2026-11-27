/**
 * Core type definitions for the SmogWise Virtual hybrid evaluator.
 */

/** One of the six competition rubric criterion identifiers. */
export type CriterionKey =
  | 'alignment'
  | 'codeQuality'
  | 'security'
  | 'efficiency'
  | 'testing'
  | 'accessibility';

/** Competition weighting tier for a rubric criterion. */
export type ImpactLevel = 'High Impact' | 'Medium Impact' | 'Low Impact';

/** Evaluation mode indicating live AI grading vs offline fallback. */
export type JudgeMode = 'live_ai_judge' | 'offline_cold_rubric';

/** Single point deduction recorded by a deterministic analyzer or AI judge. */
export interface DeductionItem {
  readonly criterion: CriterionKey;
  readonly points: number;
  readonly evidence: string;
  readonly fix: string;
}

/** Output payload produced by each deterministic static or runtime analyzer. */
export interface AnalyzerResult {
  readonly criterion: CriterionKey;
  readonly deterministicScore: number;
  readonly maxDeterministic: number;
  readonly capApplied?: number;
  readonly deductions: readonly DeductionItem[];
  readonly metrics: Readonly<Record<string, string | number | boolean>>;
}

/** Sub-scores returned by an AI rubric judge across all six criteria. */
export interface AIJudgeScores {
  readonly alignment_ai: number;
  readonly codeQuality_ai: number;
  readonly security_ai: number;
  readonly efficiency_ai: number;
  readonly testing_ai: number;
  readonly accessibility_ai: number;
}

/** Aggregated AI judge evaluation payload including mode and model provenance. */
export interface AIJudgeResult {
  readonly mode: JudgeMode;
  readonly modelsUsed: readonly string[];
  readonly scores: AIJudgeScores;
  readonly deductions: readonly DeductionItem[];
  readonly verdict: string;
}

/** Combined deterministic + AI score summary for one rubric criterion. */
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

/** Full 100-point hybrid audit report written to latest_audit.{json,md}. */
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
