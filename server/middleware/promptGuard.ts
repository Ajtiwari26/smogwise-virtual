/**
 * Zod v4 request schemas, prompt-injection/XSS detector, XML wrapper,
 * and output secret scrubber for SmogWise Virtual API.
 */

import { z } from 'zod';
import { CustomLocationSchema, stripZeroWidthAndBidi } from './locationGuard.js';

export * from './locationGuard.js';

const PERSONAS = ['young_family', 'sensitive_household', 'rwa_coordinator'] as const;
const LANGUAGES = ['en', 'hi'] as const;
const COMMUTE_MODES = [
  'petrol_car',
  'two_wheeler',
  'metro_bus',
  'carpool',
  'wfh_walk',
] as const;
const COOKING_FUELS = ['lpg', 'induction', 'biomass_chulha'] as const;
const IAQ_HACKS = [
  'window_sealing',
  'wet_mopping',
  'ventilation_window',
  'corsi_rosenthal_box',
  'hepa_purifier',
  'n95_mask',
] as const;

/** Zod schema validating a household UserProfile payload. */
export const UserProfileSchema = z.object({
  persona: z.enum(PERSONAS),
  cityId: z.string().trim().min(2).max(64),
  language: z.enum(LANGUAGES),
  householdSize: z.number().int().min(1).max(20),
  hasVulnerableMember: z.boolean(),
  monthlyBudgetInr: z.number().min(0).max(500_000),
  roomVolumeM3: z.number().min(10).max(500),
  commuteMode: z.enum(COMMUTE_MODES),
  commuteDistanceKm: z.number().min(0).max(200),
  cookingFuel: z.enum(COOKING_FUELS),
  activeHacks: z.array(z.enum(IAQ_HACKS)).max(10),
  rwaHouseholds: z.number().int().min(1).max(5000).optional(),
  rwaAdoptionRate: z.number().min(0).max(1).optional(),
  customLocation: CustomLocationSchema.optional(),
});

/** Zod schema validating POST /api/what-if payload. */
export const WhatIfSchema = z.object({
  baseline: UserProfileSchema,
  alternative: UserProfileSchema,
});

/** Zod schema validating POST /api/ai/ask payload. */
export const AiAskSchema = z
  .object({
    question: z.string().trim().min(1).max(1000).optional(),
    query: z.string().trim().min(1).max(1000).optional(),
    city: z.string().trim().min(1).max(80).optional(),
    language: z.enum(LANGUAGES).optional(),
    profile: UserProfileSchema.optional(),
  })
  .refine((data) => Boolean(data.question ?? data.query), {
    message: 'Either question or query must be provided.',
    path: ['question'],
  });

/** Result of inspecting and sanitizing a user prompt. */
export interface PromptInspectionResult {
  readonly sanitizedText: string;
  readonly guardTriggered: boolean;
  readonly reasons: readonly string[];
}

interface PatternRule {
  readonly reason: string;
  readonly regex: RegExp;
}

const DIRECT_RULES: readonly PatternRule[] = [
  {
    reason: 'instruction_override',
    regex: new RegExp(
      '(ignore|disregard)\\s+(all\\s+)?(previous|prior|above|safety)?\\s*'
        + '(instructions|rules)|system\\s+(prompt|instructions)'
        + '|forget\\s+what\\s+you\\s+were\\s+told'
        + '|reveal\\s+(?:your\\s+)?(?:system|internal)\\s+instructions',
      'i',
    ),
  },
  {
    reason: 'ssrf_or_exfil',
    regex: /169\.254\.169\.254|exfiltrate|session\s+tokens/i,
  },
  {
    reason: 'xml_delimiter_breakout',
    regex: /<\/?(user_query|system|assistant|instruction)>/i,
  },
  {
    reason: 'medical_or_dan_jailbreak',
    regex: new RegExp(
      '\\b(you\\s+are\\s+dan|prescribe|prednisone|dosage|mg\\s+dose'
        + '|inhaler|steroid|tablet|milligrams)\\b',
      'i',
    ),
  },
  {
    reason: 'xss_payload',
    regex: /<script|onerror\s*=|onload\s*=|<img\b|javascript:/i,
  },
  {
    reason: 'secret_probe',
    regex: /gemini_api_key|openai_api_key|process\.env|env\s+vars/i,
  },
  {
    reason: 'sql_injection',
    regex: /drop\s+table|'\s*or\s*'1'\s*=\s*'1|union\s+select/i,
  },
  {
    reason: 'hindi_hinglish_override',
    regex: /(purane|pichle)\s+nirdesh\s+(bhool|chhod)|system\s+prompt\s+batao|secret\s+dikhao/i,
  },
];

const BASE64_TOKEN_RE = /\b[A-Za-z0-9+/]{16,}={0,2}\b/g;
const BASE64_THREAT_RE = /ignore|rules|secret|system|prompt|api_key|password|leak/i;

function hasMarkdownImageExfil(text: string): boolean {
  const bangIdx = text.indexOf('![');
  if (bangIdx === -1) {
    return false;
  }
  const rest = text.slice(bangIdx + 2).toLowerCase();
  return rest.includes('](http://') || rest.includes('](https://');
}

function hasBase64Override(text: string): boolean {
  const matches = text.match(BASE64_TOKEN_RE);
  if (matches === null) {
    return false;
  }
  for (const token of matches) {
    try {
      const decoded = Buffer.from(token, 'base64').toString('utf8');
      if (BASE64_THREAT_RE.test(decoded)) {
        return true;
      }
    } catch {
      // Ignore non-decodable tokens
    }
  }
  return false;
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    out += code < 32 || code === 127 ? ' ' : (input[i] ?? '');
  }
  return out;
}

function sanitizeText(rawText: string): string {
  return stripControlChars(rawText.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}

/**
 * Inspects raw user text for prompt-injection, XSS, SQLi, base64 overrides,
 * medical jailbreaks, secret probes, and markdown image exfiltration.
 */
export function inspectAndSanitizePrompt(rawText: string): PromptInspectionResult {
  const normalized = stripZeroWidthAndBidi(rawText.normalize('NFKC'));
  const reasons: string[] = [];
  for (const rule of DIRECT_RULES) {
    if (rule.regex.test(normalized)) {
      reasons.push(rule.reason);
    }
  }
  if (hasMarkdownImageExfil(normalized)) {
    reasons.push('markdown_exfil');
  }
  if (hasBase64Override(normalized)) {
    reasons.push('base64_override');
  }
  return {
    sanitizedText: sanitizeText(normalized),
    guardTriggered: reasons.length > 0,
    reasons,
  };
}

/**
 * Wraps sanitized user text in structural XML delimiters to isolate untrusted input.
 */
export function wrapXmlUserQuery(text: string): string {
  const escaped = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<user_query>${escaped}</user_query>`;
}

/**
 * Scrubs potential API keys, env var names, or system-prompt echoes from output text.
 */
export function scrubSecretsFromOutput(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_-]{35}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/GEMINI_API_KEY/gi, '[REDACTED_ENV]')
    .replace(/process\.env\.[A-Z0-9_]+/gi, '[REDACTED_ENV]')
    .replace(/system\s+prompt:/gi, 'guidance:');
}
