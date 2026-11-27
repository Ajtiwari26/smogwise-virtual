/**
 * Grounded Tier 2 GenAI assistant & household briefing synthesis using
 * @google/genai Interactions API with Zod parsing, caching, singleflight, and EN/HI fallback.
 */

import { z } from 'zod';
import { computeFullPlan } from '../../src/domain/impactService.js';
import type {
  DeterministicReport,
  LanguageCode,
  LiveAqOverride,
  UserProfile,
} from '../../src/domain/types.js';
import { createLruCache, createSingleflight, hashCacheKey } from '../cache/lruCache.js';
import { getEnvConfig } from '../config/env.js';
import {
  inspectAndSanitizePrompt,
  scrubSecretsFromOutput,
  stripDisallowedCitationTags,
} from '../middleware/promptGuard.js';
import {
  extractJsonPayloadText,
  type InteractionResponseFormat,
  queryGeminiWithFallback,
} from './genaiClient.js';
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

const BRIEFING_CACHE_TTL_MS = 10 * 60 * 1000;

const BriefingJsonSchema = z.object({
  headline: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(10).max(500),
  whyActions: z.array(z.string().trim().min(6).max(260)).min(1).max(4),
});

const BRIEFING_RESPONSE_FORMAT: InteractionResponseFormat = {
  type: 'text',
  mime_type: 'application/json',
  schema: {
    type: 'object',
    required: ['headline', 'summary', 'whyActions'],
    properties: {
      headline: { type: 'string' },
      summary: { type: 'string' },
      whyActions: { type: 'array', items: { type: 'string' } },
    },
  },
};

/** Input parameters for the grounded SmogWise AI assistant. */
interface AskAssistantInput {
  readonly question: string;
  readonly profile: UserProfile;
  readonly liveAq?: LiveAqOverride;
}

/** Structured response returned by the grounded SmogWise AI assistant. */
interface AskAssistantResponse {
  readonly answer: string;
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded' | 'guard_refusal';
  readonly citationsUsed: readonly string[];
  readonly guardTriggered: boolean;
  readonly report: DeterministicReport;
}

/** Structured response returned by POST /api/plan/briefing. */
interface PlanBriefingResponse {
  readonly headline: string;
  readonly summary: string;
  readonly whyActions: readonly string[];
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded';
  readonly citationsUsed: readonly string[];
}

const briefingCache = createLruCache<PlanBriefingResponse>(100, BRIEFING_CACHE_TTL_MS);
const briefingSingleflight = createSingleflight<PlanBriefingResponse>(100);

/** Clears cached Tier 2 plan briefings and in-flight coalesced calls. */
export function clearBriefingCache(): void {
  briefingCache.clear();
  briefingSingleflight.clear();
}

function groundCitationText(cleaned: string, allowedKeys: ReadonlySet<string>): string {
  const used = extractCitations(cleaned, allowedKeys);
  const hasCalc = used.some((key) => key.startsWith('CALC:'));
  const hasAq = used.some((key) => key.startsWith('AQ:'));
  if (hasCalc && hasAq) return cleaned;
  const suffix = [!hasCalc ? '[CALC:DOSE_AFTER]' : '', !hasAq ? '[AQ:SOURCE]' : '']
    .filter(Boolean)
    .join(' ');
  return `${cleaned} ${suffix}`.trim();
}

function cleanGroundedAnswer(raw: string, allowedKeys: ReadonlySet<string>): string | undefined {
  const cleaned = stripDisallowedCitationTags(scrubSecretsFromOutput(raw), allowedKeys);
  const prose = stripDisallowedCitationTags(cleaned);
  return /[\p{L}\p{N}]/u.test(prose) ? groundCitationText(cleaned, allowedKeys) : undefined;
}

function parseBriefingPayload(
  rawText: string,
  language: LanguageCode,
  allowedKeys: ReadonlySet<string>,
): PlanBriefingResponse | null {
  try {
    const parsedJson: unknown = JSON.parse(extractJsonPayloadText(rawText));
    const parsed = BriefingJsonSchema.safeParse(parsedJson);
    if (!parsed.success) return null;
    const cleanLine = (val: string): string =>
      stripDisallowedCitationTags(scrubSecretsFromOutput(val), allowedKeys);
    const headline = cleanLine(parsed.data.headline);
    const cleanSummary = cleanLine(parsed.data.summary);
    const whyActions = parsed.data.whyActions.map(cleanLine);
    const prose = BriefingJsonSchema.safeParse({
      headline: stripDisallowedCitationTags(headline),
      summary: stripDisallowedCitationTags(cleanSummary),
      whyActions: whyActions.map((line) => stripDisallowedCitationTags(line)),
    });
    if (!prose.success) return null;
    const summary = groundCitationText(cleanSummary, allowedKeys);
    const combined = [headline, summary, ...whyActions].join(' ');
    return {
      headline,
      summary,
      whyActions,
      language,
      mode: 'gemini_interactions',
      citationsUsed: extractCitations(combined, allowedKeys),
    };
  } catch (err: unknown) {
    void err;
    return null;
  }
}

function buildOfflineBriefingResponse(
  profile: UserProfile,
  report: DeterministicReport,
  allowedKeys: ReadonlySet<string>,
): PlanBriefingResponse {
  const offline = buildOfflineBriefing(profile, report);
  const summary = scrubSecretsFromOutput(offline.summary);
  const whyActions = offline.whyActions.map((line) => scrubSecretsFromOutput(line));
  const headline = scrubSecretsFromOutput(offline.headline);
  const combined = [headline, summary, ...whyActions].join(' ');
  return {
    headline,
    summary,
    whyActions,
    language: profile.language,
    mode: 'offline_grounded',
    citationsUsed: extractCitations(combined, allowedKeys),
  };
}

/** Synthesizes a grounded EN/HI household briefing with singleflight, LRU cache & fallback. */
export async function generatePlanBriefing(
  profile: UserProfile,
  report: DeterministicReport,
): Promise<PlanBriefingResponse> {
  const userPrompt = buildBriefingUserPrompt(profile, report);
  const cacheKey = hashCacheKey({
    language: profile.language,
    cityNameHi: report.city.nameHi,
    userPrompt,
  });
  const cached = briefingCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  return briefingSingleflight.run(cacheKey, async () => {
    const allowedKeys = new Set([...SYNCED_CITATION_KEYS, ...Object.keys(report.citations)]);
    const { geminiApiKey } = getEnvConfig();
    if (geminiApiKey.length > 0) {
      const sys = buildBriefingSystemInstruction(profile.language);
      const raw = await queryGeminiWithFallback(
        geminiApiKey,
        sys,
        userPrompt,
        BRIEFING_RESPONSE_FORMAT,
      );
      if (raw !== null) {
        const parsed = parseBriefingPayload(raw, profile.language, allowedKeys);
        if (parsed !== null) {
          briefingCache.set(cacheKey, parsed, BRIEFING_CACHE_TTL_MS);
          return parsed;
        }
      }
    }
    const fallback = buildOfflineBriefingResponse(profile, report, allowedKeys);
    briefingCache.set(cacheKey, fallback, BRIEFING_CACHE_TTL_MS);
    return fallback;
  });
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
    const safeText = raw === null ? undefined : cleanGroundedAnswer(raw, allowedKeys);
    if (safeText !== undefined) {
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
