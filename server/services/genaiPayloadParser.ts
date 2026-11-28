/** Strict selection schemas and canonical response rendering for Gemini. */

import { z } from 'zod';
import type { AqResolutionStatus, DeterministicReport, LanguageCode, UserProfile }
  from '../../src/domain/types.js';
import { scrubSecretsFromOutput } from '../middleware/promptGuard.js';
import { extractJsonPayloadText, type InteractionResponseFormat } from './genaiClient.js';
import {
  buildBriefingActions, buildOfflineBriefing, formatBriefingHeadline,
} from './genaiOfflineFallbacks.js';
import { extractCitations } from './genaiPromptBuilders.js';
import { type GroundedClaims, renderGroundedClaims } from './genaiVerifier.js';

const ids = (max: number) => z.array(z.string().min(1).max(80)).min(1).max(max);
const BriefingSchema = z.strictObject({ summary: ids(6), whyActions: ids(4) });
const AnswerSchema = z.strictObject({ claims: ids(8) });

function idArray(maxItems: number) {
  return { type: 'array', items: { type: 'string' }, minItems: 1, maxItems };
}

function responseFormat(properties: Record<string, unknown>): InteractionResponseFormat {
  return {
    type: 'text',
    mime_type: 'application/json',
    schema: { type: 'object', required: Object.keys(properties), properties },
  };
}

/** Gemini briefing format selecting server-owned facts and actions. */
export const BRIEFING_RESPONSE_FORMAT = responseFormat({
  summary: idArray(6), whyActions: idArray(4),
});

/** Gemini assistant format selecting server-owned facts and tool results. */
export const ANSWER_RESPONSE_FORMAT = responseFormat({ claims: idArray(8) });

/** Response returned by POST /api/plan/briefing. */
export interface PlanBriefingResponse {
  readonly headline: string;
  readonly summary: string;
  readonly whyActions: readonly string[];
  readonly language: LanguageCode;
  readonly mode: 'gemini_interactions' | 'offline_grounded';
  readonly citationsUsed: readonly string[];
  readonly aqStatus?: AqResolutionStatus;
  readonly observationId?: string;
  readonly modelUsed?: string;
}

function readJson(raw: string): unknown {
  if (raw.length > 4096) return undefined;
  try {
    return JSON.parse(extractJsonPayloadText(raw));
  } catch {
    return undefined;
  }
}

/** Renders an assistant answer only when every requested fact belongs to this request. */
export function cleanGroundedAnswer(raw: string, claims: GroundedClaims): string | undefined {
  const parsed = AnswerSchema.safeParse(readJson(raw));
  if (!parsed.success) return undefined;
  const rendered = renderGroundedClaims(parsed.data.claims, claims);
  return rendered === undefined ? undefined : scrubSecretsFromOutput(rendered.join(' '));
}

function buildBriefingResponse(
  data: Pick<PlanBriefingResponse, 'headline' | 'summary' | 'whyActions'>,
  profile: UserProfile,
  report: DeterministicReport,
): PlanBriefingResponse {
  const headline = scrubSecretsFromOutput(data.headline);
  const summary = scrubSecretsFromOutput(data.summary);
  const whyActions = data.whyActions.map(scrubSecretsFromOutput);
  return {
    headline, summary, whyActions,
    language: profile.language,
    mode: 'offline_grounded',
    citationsUsed: extractCitations([summary, ...whyActions].join(' ')),
    ...(report.aqStatus !== undefined ? { aqStatus: report.aqStatus } : {}),
    ...(report.observationId !== undefined ? { observationId: report.observationId } : {}),
  };
}

/** Parses an exact ID selection and renders matching claims against the report and budget. */
export function parseBriefingPayload(
  raw: string,
  profile: UserProfile,
  report: DeterministicReport,
  claims: GroundedClaims,
  actions: ReturnType<typeof buildBriefingActions>,
  modelUsed?: string,
): PlanBriefingResponse | null {
  const parsed = BriefingSchema.safeParse(readJson(raw));
  if (!parsed.success) return null;
  const summary = renderGroundedClaims(parsed.data.summary, claims);
  const whyActions = renderGroundedClaims(parsed.data.whyActions, actions);
  if (summary === undefined || whyActions === undefined) return null;
  const briefing = buildBriefingResponse({
    headline: formatBriefingHeadline(profile, report), summary: summary.join(' '), whyActions,
  }, profile, report);
  return { ...briefing, mode: 'gemini_interactions', ...(modelUsed ? { modelUsed } : {}) };
}

/** Builds a deterministic scrubbed offline household briefing payload. */
export function buildOfflineBriefingResponse(
  profile: UserProfile,
  report: DeterministicReport,
): PlanBriefingResponse {
  return buildBriefingResponse(buildOfflineBriefing(profile, report), profile, report);
}
