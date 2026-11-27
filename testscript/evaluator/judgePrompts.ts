/**
 * Zod schemas, rubric instructions, score averaging, and cold-rubric fallback for aiJudge.
 */

import { z } from 'zod';
import type {
  AIJudgeResult,
  AIJudgeScores,
  AnalyzerResult,
  CriterionKey,
  DeductionItem,
} from './types.js';
import { clamp, makeDeduction, round2 } from './utils.js';

const MAX_SCORES: AIJudgeScores = {
  alignment_ai: 18,
  codeQuality_ai: 10,
  security_ai: 4,
  efficiency_ai: 3,
  testing_ai: 1,
  accessibility_ai: 1.5,
};

const CRITERION_KEYS = [
  'alignment',
  'codeQuality',
  'security',
  'efficiency',
  'testing',
  'accessibility',
] as const;

const JudgeDeductionSchema = z.object({
  criterion: z.enum(CRITERION_KEYS),
  points: z.number().min(-18).max(18).transform((val) => Math.abs(val)),
  evidence: z.string().min(3),
  fix: z.string().min(3),
});

const JudgePayloadSchema = z.object({
  scores: z.object({
    alignment_ai: z.number().min(0).max(18),
    codeQuality_ai: z.number().min(0).max(10),
    security_ai: z.number().min(0).max(4),
    efficiency_ai: z.number().min(0).max(3),
    testing_ai: z.number().min(0).max(1),
    accessibility_ai: z.number().min(0).max(1.5),
  }),
  deductions: z.array(JudgeDeductionSchema),
  verdict: z.string().min(5),
});

/** Validated structured output payload returned by an external AI judge model. */
export type ParsedJudgePayload = z.infer<typeof JudgePayloadSchema>;

/** JSON Schema passed to Gemini Interactions API response_format. */
export const JUDGE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['scores', 'deductions', 'verdict'],
  properties: {
    scores: {
      type: 'object',
      required: [
        'alignment_ai',
        'codeQuality_ai',
        'security_ai',
        'efficiency_ai',
        'testing_ai',
        'accessibility_ai',
      ],
      properties: {
        alignment_ai: { type: 'number' },
        codeQuality_ai: { type: 'number' },
        security_ai: { type: 'number' },
        efficiency_ai: { type: 'number' },
        testing_ai: { type: 'number' },
        accessibility_ai: { type: 'number' },
      },
    },
    deductions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['criterion', 'points', 'evidence', 'fix'],
        properties: {
          criterion: { type: 'string', enum: [...CRITERION_KEYS] },
          points: { type: 'number' },
          evidence: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
    verdict: { type: 'string' },
  },
};

/** Anti-inflation staff-engineer rubric sent as system instruction to judge models. */
export const SYSTEM_RUBRIC = [
  'You are a brutally strict, anti-inflation staff engineer auditing SmogWise Virtual.',
  'Start skeptical: even top 98% competition entries have real micro-flaws. Never give',
  '100% across all categories unless zero gaps exist in code, tests, docs, and UX.',
  'If server/app.ts or src/App.tsx is missing, cap alignment_ai<=2, codeQuality_ai<=6,',
  'and accessibility_ai=0. Deduct fractional points for generic fluff, missing impact clarity,',
  'budget mismatches, missing README sections (vertical, logic, how it works, assumptions),',
  'prompt-injection leaks, medical prescribing, missing test assertions, or security/a11y flaws.',
  'Max scores: alignment_ai=18, codeQuality_ai=10, security_ai=4, efficiency_ai=3,',
  'testing_ai=1, accessibility_ai=1.5. Return ONLY valid JSON matching the schema.',
].join(' ');

/** Parses and Zod-validates JSON returned by a judge LLM. */
export function parseJudgeJson(rawText: string): ParsedJudgePayload | null {
  if (rawText.trim().length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(rawText);
    const checked = JudgePayloadSchema.safeParse(parsed);
    return checked.success ? checked.data : null;
  } catch (err: unknown) {
    void err;
    return null;
  }
}

function clampScores(scores: AIJudgeScores): AIJudgeScores {
  return {
    alignment_ai: round2(clamp(scores.alignment_ai, 0, MAX_SCORES.alignment_ai)),
    codeQuality_ai: round2(clamp(scores.codeQuality_ai, 0, MAX_SCORES.codeQuality_ai)),
    security_ai: round2(clamp(scores.security_ai, 0, MAX_SCORES.security_ai)),
    efficiency_ai: round2(clamp(scores.efficiency_ai, 0, MAX_SCORES.efficiency_ai)),
    testing_ai: round2(clamp(scores.testing_ai, 0, MAX_SCORES.testing_ai)),
    accessibility_ai: round2(clamp(scores.accessibility_ai, 0, MAX_SCORES.accessibility_ai)),
  };
}

/** Averages AI judge sub-scores across all responding models and clamps within limits. */
export function averageScores(list: readonly ParsedJudgePayload[]): AIJudgeScores {
  const n = Math.max(1, list.length);
  const avg = (pick: (s: AIJudgeScores) => number): number =>
    round2(list.reduce((acc, item) => acc + pick(item.scores), 0) / n);
  return clampScores({
    alignment_ai: avg((s) => s.alignment_ai),
    codeQuality_ai: avg((s) => s.codeQuality_ai),
    security_ai: avg((s) => s.security_ai),
    efficiency_ai: avg((s) => s.efficiency_ai),
    testing_ai: avg((s) => s.testing_ai),
    accessibility_ai: avg((s) => s.accessibility_ai),
  });
}

/** Deduplicates AI judge deductions across cross-model responses. */
export function mergeDeductions(list: readonly ParsedJudgePayload[]): readonly DeductionItem[] {
  const seen = new Set<string>();
  const merged: DeductionItem[] = [];
  for (const item of list) {
    for (const d of item.deductions) {
      const key = `${d.criterion}:${d.evidence.slice(0, 48).toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(makeDeduction(d.criterion, d.points, d.evidence, d.fix));
      }
    }
  }
  return merged;
}

function ratioForCriterion(results: readonly AnalyzerResult[], criterion: CriterionKey): number {
  const found = results.find((r) => r.criterion === criterion);
  if (found === undefined || found.maxDeterministic <= 0) return 0;
  return clamp(found.deterministicScore / found.maxDeterministic, 0, 1);
}

/** Computes deterministic 80%-capped AI fallback scores when no judge API keys are configured. */
export function buildColdFallback(
  deterministicResults: readonly AnalyzerResult[],
  okProbes: number,
): AIJudgeResult {
  const cap = 0.8;
  const scale = (k: CriterionKey, max: number): number =>
    round2(clamp(ratioForCriterion(deterministicResults, k) * max * cap, 0, max * cap));
  const scores: AIJudgeScores = {
    alignment_ai: scale('alignment', MAX_SCORES.alignment_ai),
    codeQuality_ai: scale('codeQuality', MAX_SCORES.codeQuality_ai),
    security_ai: scale('security', MAX_SCORES.security_ai),
    efficiency_ai: scale('efficiency', MAX_SCORES.efficiency_ai),
    testing_ai: scale('testing', MAX_SCORES.testing_ai),
    accessibility_ai: scale('accessibility', MAX_SCORES.accessibility_ai),
  };
  const deductions: DeductionItem[] = [
    makeDeduction(
      'alignment',
      round2(MAX_SCORES.alignment_ai * 0.2),
      'Offline cold rubric active (no live AI judge keys); AI share capped at 80%.',
      'Set GEMINI_API_KEY (and optionally OPENAI_API_KEY) for live cross-model grading.',
    ),
  ];
  return {
    mode: 'offline_cold_rubric',
    modelsUsed: ['offline_cold_rubric'],
    scores,
    deductions,
    verdict: `Offline cold rubric (80% AI cap). Live persona probes reachable: ${okProbes}/5.`,
  };
}
