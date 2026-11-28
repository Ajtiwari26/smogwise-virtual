/**
 * Bounded read-only Tier 1 function-calling tools for Gemini Interactions Q&A.
 */

import type { Interactions } from '@google/genai';
import { isPlainRecord } from '../../src/domain/domainUtils.js';
import { compareWhatIfFromBaseline } from '../../src/domain/impactService.js';
import {
  COMMUTE_MODES,
  COOKING_FUELS,
  type CommuteMode,
  type CookingFuel,
  type DeterministicReport,
  type IAQHackId,
  type LiveAqOverride,
  type UserProfile,
} from '../../src/domain/types.js';
import { formatBudgetOptions, readBudgetCap } from './genaiBudget.js';

/** Parsed Gemini Interactions function_call step awaiting local execution. */
export interface ParsedFunctionCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown>;
}

/** Tool execution outcome containing JSON output and verified numeric claims. */
export interface ExecutedToolResult {
  readonly callId: string;
  readonly name: string;
  readonly data: unknown;
  readonly claim?: string;
}

/** Bounded read-only tool declarations exposed on /api/ai/ask Interactions calls. */
export const ASSISTANT_TOOLS: Interactions.Tool[] = [
  {
    type: 'function',
    name: 'filter_iaq_hacks_by_budget',
    description:
      'Returns verified indoor air quality interventions affordable within a monthly INR budget.',
    parameters: {
      type: 'object',
      properties: {
        maxBudgetInr: { type: 'number', description: 'Maximum monthly INR spend limit.' },
      },
      required: ['maxBudgetInr'],
    },
  },
  {
    type: 'function',
    name: 'simulate_what_if_scenario',
    description:
      'Runs deterministic physics & emissions comparison when changing commute mode or cooking fuel.',
    parameters: {
      type: 'object',
      properties: {
        commuteMode: { type: 'string', enum: [...COMMUTE_MODES] },
        cookingFuel: { type: 'string', enum: [...COOKING_FUELS] },
        addCorsiBox: { type: 'boolean' },
      },
    },
  },
];

function isCommuteMode(val: unknown): val is CommuteMode {
  return typeof val === 'string' && COMMUTE_MODES.some((m) => m === val);
}

function isCookingFuel(val: unknown): val is CookingFuel {
  return typeof val === 'string' && COOKING_FUELS.some((f) => f === val);
}

function runBudgetHackTool(
  call: ParsedFunctionCall,
  profile: UserProfile,
  question: string,
): ExecutedToolResult {
  const maxBudgetInr = readBudgetCap(question) ?? profile.monthlyBudgetInr;
  return {
    callId: call.id, name: call.name,
    data: { maxBudgetInr },
    claim: formatBudgetOptions(maxBudgetInr, profile.language),
  };
}

function runWhatIfTool(
  call: ParsedFunctionCall, context: AssistantToolContext,
): ExecutedToolResult {
  const { profile, report, liveAq } = context;
  const { commuteMode, cookingFuel, addCorsiBox } = call.arguments;
  const activeHacks: readonly IAQHackId[] = addCorsiBox === true
    ? [...new Set([...profile.activeHacks, 'corsi_rosenthal_box' as const])]
    : profile.activeHacks;
  const alternative: UserProfile = {
    ...profile,
    commuteMode: isCommuteMode(commuteMode) ? commuteMode : profile.commuteMode,
    cookingFuel: isCookingFuel(cookingFuel) ? cookingFuel : profile.cookingFuel,
    activeHacks,
  };
  const cmp = compareWhatIfFromBaseline(profile, report, alternative, liveAq);
  const change = [alternative.commuteMode, alternative.cookingFuel, ...activeHacks].join(', ');
  const intro = profile.language === 'hi' ? 'सिमुलेशन की सेटिंग' : 'Simulated settings';
  return {
    callId: call.id, name: call.name,
    data: cmp.delta,
    claim: `${intro}: ${change}. ${cmp.explanation[profile.language]} [AQ:SOURCE]`,
  };
}

/** Parses local tool arguments from SDK function-call steps. */
export function extractFunctionCalls(
  steps: readonly Interactions.Step[],
): readonly ParsedFunctionCall[] {
  return steps.flatMap((step) => {
    if (step.type !== 'function_call') return [];
    const args: unknown = step.arguments;
    return [{ id: step.id, name: step.name, arguments: isPlainRecord(args) ? args : {} }];
  });
}

/** Current request context for local tools. */
export interface AssistantToolContext {
  readonly profile: UserProfile;
  readonly report: DeterministicReport;
  readonly question: string;
  readonly budgetOnly: boolean;
  readonly liveAq?: LiveAqOverride;
}

/** Executes only the declared local tools against the current request's snapshot. */
export function executeAssistantToolCall(
  call: ParsedFunctionCall,
  context: AssistantToolContext,
): ExecutedToolResult {
  if (call.name === 'filter_iaq_hacks_by_budget') {
    return runBudgetHackTool(call, context.profile, context.question);
  }
  const { aqStatus } = context.report;
  if (call.name === 'simulate_what_if_scenario' && !context.budgetOnly
    && aqStatus !== 'unavailable' && aqStatus !== 'pending') {
    return runWhatIfTool(call, context);
  }
  return { callId: call.id, name: call.name, data: { error: 'Tool unavailable for this request' } };
}
