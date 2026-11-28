import { stripCitationTags } from './textSanitizer.js';
/**
 * Prompt-injection/XSS/SQLi detector, XML wrapper, and output secret scrubber.
 */

import { getEnvConfig } from '../config/env.js';
import { MAX_ASSISTANT_QUESTION_LENGTH } from '../../src/domain/constants.js';
import { escapeXml, stripZeroWidthAndBidi } from './locationGuard.js';

/** Result of inspecting and sanitizing a user prompt. */
interface PromptInspectionResult {
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
    regex: new RegExp(
      '169\\.254\\.169\\.254|exfiltrate|session\\s+tokens|'
        + 'document\\.cookie|localstorage|sessionstorage',
      'i',
    ),
  },
  {
    reason: 'xml_delimiter_breakout',
    regex: /<\/?(user_query|system|assistant|instruction)>/i,
  },
  {
    reason: 'medical_or_dan_jailbreak',
    regex: new RegExp(
      '\\b(you\\s+are\\s+dan|prescribe|prednisone|dosage|mg\\s+dose|milligrams'
        + '|recommend\\s+(?:a|an|some|exact)?\\s*(?:[a-z]+\\s+){0,3}'
        + '(?:tablet|dosage|medication|prescription|steroid))\\b',
      'i',
    ),
  },
  {
    reason: 'xss_payload',
    regex: new RegExp(
      '<script|<svg|<iframe|<object|onerror\\s*=|onload\\s*=|onfocus\\s*=|onmouseover\\s*='
        + '|<img\\b|javascript:',
      'i',
    ),
  },
  {
    reason: 'secret_probe',
    regex: /gemini_api_key|openai_api_key|auth_secret|process\.env|env\s+vars/i,
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

const BASE64_TOKEN_RE =
  /(?:^|[^A-Za-z0-9+/_-])([A-Za-z0-9+/_-]{12,}={0,2})(?:$|[^A-Za-z0-9+/_=-])/g;
const BASE64_THREAT_RE = new RegExp(
  'ignore|rules|secret|system|prompt|api_key|password|leak|'
    + 'prednisone|dosage|instructions|override|jailbreak|token|env|169\\.254',
  'i',
);

function hasMarkdownExfil(text: string): boolean {
  const lower = text.toLowerCase();
  let pos = 0;
  while (pos < lower.length) {
    const linkIdx = lower.indexOf('](', pos);
    if (linkIdx === -1) {
      return false;
    }
    const tail = lower.slice(linkIdx + 2).trimStart();
    if (tail.startsWith('http://') || tail.startsWith('https://') || tail.startsWith('//')) {
      return true;
    }
    pos = linkIdx + 2;
  }
  return false;
}

function hasBase64Override(text: string): boolean {
  for (const match of text.matchAll(BASE64_TOKEN_RE)) {
    const token = match[1];
    if (token === undefined) {
      continue;
    }
    const stdBase64 = token.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(stdBase64, 'base64').toString('utf8');
    if (BASE64_THREAT_RE.test(decoded)) {
      return true;
    }
  }
  return false;
}

function stripAngleTagNoise(input: string): string {
  return input.replace(/<[^<>]*>/g, ' ');
}

/** Removes citation tags other than exact keys supplied by the deterministic report. */
export function stripDisallowedCitationTags(
  text: string,
  allowedKeys?: ReadonlySet<string>,
): string {
  return stripCitationTags(text, allowedKeys)
    .replace(/ {2,}/g, ' ')
    .trim();
}

function stripControlChars(input: string, replacement = '', keepLineBreaks = false): string {
  const allowedControls = keepLineBreaks ? '\r\n' : '';
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    const char = input.charAt(i);
    const isControl = code < 32 || (code >= 127 && code <= 159);
    out += isControl && !allowedControls.includes(char) ? replacement : char;
  }
  return out;
}

function sanitizeText(text: string): string {
  return stripDisallowedCitationTags(stripAngleTagNoise(text))
    .replace(/[^\S\r\n\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, MAX_ASSISTANT_QUESTION_LENGTH);
}

function getScanVariants(text: string): readonly [string, ...string[]] {
  const joined = stripControlChars(text);
  // Check both word boundaries and controls that split a word or tag.
  return joined.length === text.length ? [text] : [stripControlChars(text, ' ', true), joined];
}

/**
 * Inspects raw user text for prompt-injection, XSS, SQLi, base64 overrides,
 * medical jailbreaks, secret probes, and markdown exfiltration links.
 */
export function inspectAndSanitizePrompt(rawText: string): PromptInspectionResult {
  const normalized = stripZeroWidthAndBidi(rawText.normalize('NFKC'));
  const variants = getScanVariants(normalized);
  const reasons: string[] = [];
  for (const rule of DIRECT_RULES) {
    if (variants.some((text) => rule.regex.test(text))) {
      reasons.push(rule.reason);
    }
  }
  if (variants.some(hasMarkdownExfil)) {
    reasons.push('markdown_exfil');
  }
  if (variants.some(hasBase64Override)) {
    reasons.push('base64_override');
  }
  return {
    sanitizedText: sanitizeText(variants[0]),
    guardTriggered: reasons.length > 0,
    reasons,
  };
}

/**
 * Wraps sanitized user text in structural XML delimiters to isolate untrusted input.
 */
export function wrapXmlUserQuery(text: string): string {
  return `<user_query>${escapeXml(text)}</user_query>`;
}

/**
 * Scrubs API keys, Bearer tokens, env var names, runtime secrets, and system-prompt echoes.
 */
export function scrubSecretsFromOutput(text: string): string {
  let scrubbed = text
    .replace(/AIza[0-9A-Za-z_-]{35}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{36}/g, '[REDACTED]')
    .replace(/AKIA[0-9A-Z]{16}/g, '[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, 'Bearer [REDACTED]')
    .replace(/(GEMINI_API_KEY|OPENAI_API_KEY|AUTH_SECRET)/gi, '[REDACTED_ENV]')
    .replace(/process\.env\.[A-Z0-9_]+/gi, '[REDACTED_ENV]')
    .replace(/system\s+prompt:/gi, 'guidance:');

  const env = getEnvConfig();
  for (const runtimeSecret of [env.geminiApiKey, env.authSecret]) {
    if (runtimeSecret.length >= 12 && scrubbed.includes(runtimeSecret)) {
      scrubbed = scrubbed.split(runtimeSecret).join('[REDACTED]');
    }
  }
  return scrubbed;
}
