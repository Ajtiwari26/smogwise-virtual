/**
 * Grounded Tier 2 GenAI assistant & household briefing synthesis using
 * @google/genai Interactions API with Zod parsing, caching, and EN/HI fallback.
 */

import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { computeFullPlan } from '../../src/domain/impactService.js';
import type {
  DeterministicReport,
  LanguageCode,
  LiveAqOverride,
  UserProfile,
} from '../../src/domain/types.js';
import { createLruCache, hashCacheKey } from '../cache/lruCache.js';
import { getEnvConfig } from '../config/env.js';
import {
  inspectAndSanitizePrompt,
  scrubSecretsFromOutput,
} from '../middleware/promptGuard.js';
import {
  buildBriefingSystemInstruction,
  buildBriefingUserPrompt,
  buildGuardRefusal,
  buildOfflineAnswer,
  buildOfflineBriefing,
  buildSystemInstruction,
  buildUserPrompt,
  extractCitations,
  SYNCED_CITATION_KEYS,
} from './genaiPromptBuilders.js';

const PRIMARY_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODEL = 'gemini-4-hydrogen';
const PRIMARY_TIMEOUT_MS = 4500;
const FALLBACK_TIMEOUT_MS = 1800;
const TOTAL_LLM_BUDGET_MS = 5500;
const MIN_FALLBACK_BUDGET_MS = 800;
const BRIEFING_CACHE_TTL_MS = 10 * 60 * 1000;

let cachedClient: { readonly apiKey: string; readonly client: GoogleGenAI } | null = null;

function getGenAiClient(apiKey: string): GoogleGenAI {
  if (cachedClient !== null && cachedClient.apiKey === apiKey) {
    return cachedClient.client;
  }
  const client = new GoogleGenAI({ apiKey });
  cachedClient = { apiKey, client };
  return client;
}

const BriefingJsonSchema = z.object({
  headline: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(10).max(500),
  whyActions: z.array(z.string().trim().min(6).max(260)).min(1).max(4),
});

/** Input parameters for the grounded SmogWise AI assistant. */
export interface AskAssistantInput {
  readonly question: string;
  readonly profile: UserProfile;
  readonly liveAq?: LiveAqOverride;
}

/** Structured response returned by the grounded SmogWise AI assistant. */
export interface AskAssistantResponse {
  readonly answer: string;
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded' | 'guard_refusal';
  readonly citationsUsed: readonly string[];
  readonly guardTriggered: boolean;
  readonly report: DeterministicReport;
}

/** Structured response returned by POST /api/plan/briefing. */
export interface PlanBriefingResponse {
  readonly headline: string;
  readonly summary: string;
  readonly whyActions: readonly string[];
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded';
  readonly citationsUsed: readonly string[];
}

const briefingCache = createLruCache<PlanBriefingResponse>(100, BRIEFING_CACHE_TTL_MS);

/** Clears cached Tier 2 plan briefings (used in tests). */
export function clearBriefingCache(): void {
  briefingCache.clear();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractInteractionText(response: unknown): string | null {
  if (!isRecord(response)) {
    return null;
  }
  const direct = response['output_text'];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const outputs = response['outputs'];
  if (!Array.isArray(outputs)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of outputs) {
    if (isRecord(item) && typeof item['text'] === 'string') {
      parts.push(item['text']);
    }
  }
  const joined = parts.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

async function callInteractionModel(
  client: GoogleGenAI,
  model: string,
  systemInstruction: string,
  input: string,
  timeoutMs: number,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  let apiPromise: Promise<string | null>;
  try {
    const rawCall = client.interactions.create(
      {
        model,
        system_instruction: systemInstruction,
        input,
        store: false,
      },
      { timeout_ms: timeoutMs },
    );
    apiPromise = Promise.resolve(rawCall)
      .then((res) => extractInteractionText(res))
      .catch(() => null);
  } catch {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    return null;
  }

  try {
    return await Promise.race([apiPromise, timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

async function queryGeminiWithFallback(
  apiKey: string,
  systemInstruction: string,
  input: string,
): Promise<string | null> {
  const client = getGenAiClient(apiKey);
  const deadline = Date.now() + TOTAL_LLM_BUDGET_MS;
  const primary = await callInteractionModel(
    client,
    PRIMARY_MODEL,
    systemInstruction,
    input,
    PRIMARY_TIMEOUT_MS,
  );
  if (primary !== null) {
    return primary;
  }
  const remaining = deadline - Date.now();
  if (remaining < MIN_FALLBACK_BUDGET_MS) {
    return null;
  }
  const fallbackTimeout = Math.min(FALLBACK_TIMEOUT_MS, remaining);
  return callInteractionModel(
    client,
    FALLBACK_MODEL,
    systemInstruction,
    input,
    fallbackTimeout,
  );
}

function ensureMinimumCitations(text: string): string {
  const hasCalc = text.includes('[CALC:');
  const hasAq = text.includes('[AQ:');
  if (hasCalc && hasAq) {
    return text;
  }
  const suffix = [!hasCalc ? '[CALC:DOSE_AFTER]' : '', !hasAq ? '[AQ:SOURCE]' : '']
    .filter((token) => token.length > 0)
    .join(' ');
  return `${text} ${suffix}`.trim();
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  const firstNewline = trimmed.indexOf('\n');
  const lastFence = trimmed.lastIndexOf('```');
  if (firstNewline === -1 || lastFence <= firstNewline) {
    return trimmed;
  }
  return trimmed.slice(firstNewline + 1, lastFence).trim();
}

function parseBriefingPayload(
  rawText: string,
  language: LanguageCode,
  allowedKeys: ReadonlySet<string>,
): PlanBriefingResponse | null {
  try {
    const parsedJson: unknown = JSON.parse(stripCodeFences(rawText));
    const parsed = BriefingJsonSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return null;
    }
    const headline = scrubSecretsFromOutput(parsed.data.headline);
    const summary = ensureMinimumCitations(scrubSecretsFromOutput(parsed.data.summary));
    const whyActions = parsed.data.whyActions.map((line) => scrubSecretsFromOutput(line));
    const combined = [headline, summary, ...whyActions].join(' ');
    return {
      headline,
      summary,
      whyActions,
      language,
      mode: 'gemini_interactions',
      citationsUsed: extractCitations(combined, allowedKeys),
    };
  } catch {
    return null;
  }
}

/** Synthesizes a grounded EN/HI household action briefing with LRU caching & fallback. */
export async function generatePlanBriefing(
  profile: UserProfile,
  report: DeterministicReport,
): Promise<PlanBriefingResponse> {
  const profileCacheFields: Omit<UserProfile, 'rwaHouseholds' | 'rwaAdoptionRate'> = {
    persona: profile.persona,
    cityId: profile.cityId,
    language: profile.language,
    householdSize: profile.householdSize,
    hasVulnerableMember: profile.hasVulnerableMember,
    monthlyBudgetInr: profile.monthlyBudgetInr,
    roomVolumeM3: profile.roomVolumeM3,
    commuteMode: profile.commuteMode,
    commuteDistanceKm: profile.commuteDistanceKm,
    cookingFuel: profile.cookingFuel,
    activeHacks: profile.activeHacks,
    ...(profile.customLocation !== undefined ? { customLocation: profile.customLocation } : {}),
  };
  const cacheKey = hashCacheKey({
    type: 'briefing',
    profile: profileCacheFields,
    cityId: report.city.id,
    cpcbAqi: report.cpcbAqi,
    doseAfter: report.exposure.optimizedInhaledUgPerDay,
  });
  const cached = briefingCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const allowedKeys = new Set([...SYNCED_CITATION_KEYS, ...Object.keys(report.citations)]);
  const { geminiApiKey } = getEnvConfig();
  if (geminiApiKey.length > 0) {
    const sys = buildBriefingSystemInstruction(profile.language);
    const user = buildBriefingUserPrompt(profile, report);
    const raw = await queryGeminiWithFallback(geminiApiKey, sys, user);
    if (raw !== null) {
      const parsed = parseBriefingPayload(raw, profile.language, allowedKeys);
      if (parsed !== null) {
        briefingCache.set(cacheKey, parsed, BRIEFING_CACHE_TTL_MS);
        return parsed;
      }
    }
  }
  const offline = buildOfflineBriefing(profile, report);
  const summary = scrubSecretsFromOutput(offline.summary);
  const whyActions = offline.whyActions.map((line) => scrubSecretsFromOutput(line));
  const headline = scrubSecretsFromOutput(offline.headline);
  const combined = [headline, summary, ...whyActions].join(' ');
  const fallback: PlanBriefingResponse = {
    headline,
    summary,
    whyActions,
    language: profile.language,
    mode: 'offline_grounded',
    citationsUsed: extractCitations(combined, allowedKeys),
  };
  briefingCache.set(cacheKey, fallback, BRIEFING_CACHE_TTL_MS);
  return fallback;
}

/** Computes Tier 1 deterministic plan and synthesizes a grounded bilingual Q&A answer. */
export async function askGroundedAssistant(
  input: AskAssistantInput,
): Promise<AskAssistantResponse> {
  const inspection = inspectAndSanitizePrompt(input.question);
  const plan = computeFullPlan(input.profile, input.liveAq);
  const { language } = input.profile;
  const allowedKeys = new Set([...SYNCED_CITATION_KEYS, ...Object.keys(plan.report.citations)]);
  if (inspection.guardTriggered) {
    const refusal = scrubSecretsFromOutput(buildGuardRefusal(plan, language));
    return {
      answer: refusal,
      language,
      mode: 'guard_refusal',
      citationsUsed: extractCitations(refusal, allowedKeys),
      guardTriggered: true,
      report: plan.report,
    };
  }
  const { geminiApiKey } = getEnvConfig();
  if (geminiApiKey.length > 0) {
    const sys = buildSystemInstruction(language);
    const prompt = buildUserPrompt(inspection.sanitizedText, input.profile, plan);
    const raw = await queryGeminiWithFallback(geminiApiKey, sys, prompt);
    if (raw !== null) {
      const safeText = ensureMinimumCitations(scrubSecretsFromOutput(raw));
      return {
        answer: safeText,
        language,
        mode: 'gemini_interactions',
        citationsUsed: extractCitations(safeText, allowedKeys),
        guardTriggered: false,
        report: plan.report,
      };
    }
  }
  const offline = scrubSecretsFromOutput(buildOfflineAnswer(plan, language));
  return {
    answer: offline,
    language,
    mode: 'offline_grounded',
    citationsUsed: extractCitations(offline, allowedKeys),
    guardTriggered: false,
    report: plan.report,
  };
}
