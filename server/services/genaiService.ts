/**
 * Grounded Tier 2 GenAI assistant & household briefing synthesis using
 * @google/genai Interactions API with Zod parsing, caching, singleflight, and EN/HI fallback.
 */

import { computeFullPlan } from '../../src/domain/impactService.js';
import type {
  DeterministicReport,
  FullPlanOutput,
  LanguageCode,
  LiveAqOverride,
  UserProfile,
} from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { getEnvConfig } from '../config/env.js';
import { inspectAndSanitizePrompt, scrubSecretsFromOutput } from '../middleware/promptGuard.js';
import { queryGeminiWithFallback } from './genaiClient.js';
import {
  ANSWER_RESPONSE_FORMAT,
  BRIEFING_RESPONSE_FORMAT,
  buildOfflineBriefingResponse,
  cleanGroundedAnswer,
  parseBriefingPayload,
  type PlanBriefingResponse,
} from './genaiPayloadParser.js';
import {
  buildBriefingSystemInstruction,
  buildBriefingUserPrompt,
  buildGuardRefusal,
  buildOfflineAnswer,
  buildSystemInstruction,
  buildUserPrompt,
  extractCitations,
} from './genaiPromptBuilders.js';
import { buildBriefingActions } from './genaiOfflineFallbacks.js';
import { buildGroundedClaims, type GroundedClaims } from './genaiVerifier.js';
import { formatBudgetOptions, isBudgetQuestion, readBudgetCap } from './genaiBudget.js';
import { ASSISTANT_TOOLS, executeAssistantToolCall } from './genaiTools.js';

const BRIEFING_CACHE_TTL_MS = 10 * 60 * 1000;

/** Input parameters for the grounded SmogWise AI assistant. */
interface AskAssistantInput {
  readonly question: string;
  readonly profile: UserProfile;
  readonly liveAq?: LiveAqOverride;
  readonly plan?: FullPlanOutput;
}

/** Structured response returned by the grounded SmogWise AI assistant. */
interface AskAssistantResponse {
  readonly answer: string;
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded' | 'guard_refusal';
  readonly citationsUsed: readonly string[];
  readonly guardTriggered: boolean;
  readonly modelUsed?: string;
  readonly report: DeterministicReport;
}

const briefingCache = createLruCache<PlanBriefingResponse>(100, BRIEFING_CACHE_TTL_MS);
const briefingSingleflight = createSingleflight<PlanBriefingResponse>(100);

/** Clears cached Tier 2 plan briefings and in-flight coalesced calls. */
export function clearBriefingCache(): void {
  briefingCache.clear();
  briefingSingleflight.clear();
}

function compactReportForAssistant(report: DeterministicReport): DeterministicReport {
  const { hourlySeries: _omitted, ...compactExposure } = report.exposure;
  void _omitted;
  return { ...report, exposure: compactExposure };
}

function buildBriefingCacheKey(profile: UserProfile, report: DeterministicReport): string {
  return hashCacheKey({
    language: profile.language,
    cityId: report.city.id,
    cityName: report.city.name,
    cityNameHi: report.city.nameHi,
    dataSource: report.dataSource,
    aqStatus: report.aqStatus,
    observationId: report.observationId,
    cpcbAqi: report.cpcbAqi,
    baselinePm25: report.city.baselinePm25,
    budget: profile.monthlyBudgetInr,
    householdSize: profile.householdSize,
    roomVolumeM3: profile.roomVolumeM3,
    commuteMode: profile.commuteMode,
    commuteDistanceKm: profile.commuteDistanceKm,
    cookingFuel: profile.cookingFuel,
    hasVulnerableMember: profile.hasVulnerableMember,
    hacks: [...profile.activeHacks].sort(),
    customLocation: profile.customLocation,
    doseAfter: report.exposure.optimizedInhaledUgPerDay,
    indoorAfter: report.exposure.optimizedIndoorPm25,
    co2eSaved: report.emissions.co2eAvoidedGramsPerDay,
    observedAt: report.observedAt ?? '',
  });
}

/** Synthesizes a grounded EN/HI household briefing with singleflight, LRU cache & fallback. */
export async function generatePlanBriefing(
  profile: UserProfile,
  report: DeterministicReport,
): Promise<PlanBriefingResponse> {
  const cacheKey = buildBriefingCacheKey(profile, report);
  const cached = briefingCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const fallback = () => buildOfflineBriefingResponse(profile, report);
  return briefingSingleflight.run(cacheKey, async (isCurrent) => {
    const { geminiApiKey } = getEnvConfig();
    const { aqStatus } = report;
    if (geminiApiKey.length === 0 || aqStatus === 'unavailable' || aqStatus === 'pending') {
      return fallback();
    }
    const parsed = await requestBriefing(geminiApiKey, profile, report);
    if (parsed === null) return fallback();
    if (isCurrent()) briefingCache.set(cacheKey, parsed);
    return parsed;
  }, fallback);
}

async function requestBriefing(
  apiKey: string, profile: UserProfile, report: DeterministicReport,
): Promise<PlanBriefingResponse | null> {
  const claims = buildGroundedClaims(profile, report);
  const actions = buildBriefingActions(profile, report);
  const prompt = buildBriefingUserPrompt(profile, report, claims, actions);
  const sys = buildBriefingSystemInstruction(profile.language);
  const parse = (text: string, model?: string) =>
    parseBriefingPayload(text, profile, report, claims, actions, model);
  const result = await queryGeminiWithFallback(apiKey, sys, prompt, {
    responseFormat: BRIEFING_RESPONSE_FORMAT,
    validateResponse: (text) => parse(text) !== null,
  });
  return result === null ? null : parse(result.text, result.modelUsed);
}

function answerClaims(question: string, profile: UserProfile, report: DeterministicReport) {
  if (!isBudgetQuestion(question)) return buildGroundedClaims(profile, report);
  const cap = readBudgetCap(question) ?? profile.monthlyBudgetInr;
  return new Map([['BUDGET_OPTIONS', formatBudgetOptions(cap, profile.language)]]);
}

function mergeClaims(base: GroundedClaims, tools: GroundedClaims): GroundedClaims {
  return new Map([...base, ...tools]);
}

async function runOnlineAssistant(
  question: string,
  input: AskAssistantInput,
  plan: FullPlanOutput,
): Promise<AskAssistantResponse | null> {
  const { geminiApiKey } = getEnvConfig();
  const { aqStatus } = plan.report;
  if (geminiApiKey.length === 0 || aqStatus === 'unavailable' || aqStatus === 'pending') return null;
  const sys = buildSystemInstruction(input.profile.language);
  const claims = answerClaims(question, input.profile, plan.report);
  const prompt = buildUserPrompt(question, input.profile, plan, claims);
  const budgetOnly = isBudgetQuestion(question);
  const render = (raw: string, toolClaims: GroundedClaims) =>
    cleanGroundedAnswer(raw, mergeClaims(claims, toolClaims));
  const result = await queryGeminiWithFallback(geminiApiKey, sys, prompt, {
    responseFormat: ANSWER_RESPONSE_FORMAT,
    tools: budgetOnly ? ASSISTANT_TOOLS.slice(0, 1) : ASSISTANT_TOOLS,
    executeTools: (calls) => calls.map((call) => executeAssistantToolCall(call, {
      budgetOnly,
      profile: input.profile, report: plan.report, question,
      ...(input.liveAq !== undefined ? { liveAq: input.liveAq } : {}),
    })),
    validateResponse: (raw, toolClaims) => render(raw, toolClaims) !== undefined,
  });
  if (result === null) return null;
  const answer = render(result.text, result.toolClaims);
  if (answer === undefined) return null;
  return {
    answer,
    language: input.profile.language,
    mode: 'gemini_interactions',
    citationsUsed: extractCitations(answer),
    guardTriggered: false,
    ...(result.modelUsed !== undefined ? { modelUsed: result.modelUsed } : {}),
    report: compactReportForAssistant(plan.report),
  };
}

/** Computes Tier 1 deterministic plan and synthesizes a grounded bilingual Q&A answer. */
export async function askGroundedAssistant(
  input: AskAssistantInput,
): Promise<AskAssistantResponse> {
  const inspection = inspectAndSanitizePrompt(input.question);
  const plan = input.plan ?? computeFullPlan(input.profile, input.liveAq);
  const { language } = input.profile;
  const compactReport = compactReportForAssistant(plan.report);
  if (inspection.guardTriggered) {
    const refusal = scrubSecretsFromOutput(buildGuardRefusal(plan, language));
    return {
      answer: refusal,
      language,
      mode: 'guard_refusal',
      citationsUsed: extractCitations(refusal),
      guardTriggered: true,
      report: compactReport,
    };
  }
  const online = await runOnlineAssistant(inspection.sanitizedText, input, plan);
  if (online !== null) return online;
  const offline = scrubSecretsFromOutput(
    buildOfflineAnswer(plan, input.profile, inspection.sanitizedText),
  );
  return {
    answer: offline,
    language,
    mode: 'offline_grounded',
    citationsUsed: extractCitations(offline),
    guardTriggered: false,
    report: compactReport,
  };
}
