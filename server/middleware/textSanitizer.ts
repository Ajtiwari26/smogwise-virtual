/**
 * Unicode BiDi/zero-width normalization, citation tag stripping, XML escaping,
 * and SSRF/injection detection helpers for location queries and identifiers.
 */

/** Balanced character class for safe Unicode city names including Devanagari/Indic marks. */
export const SAFE_CITY_RE = /^[\p{L}\p{N}(][\p{L}\p{M}\p{N} .\-()]{0,63}$/u;

/** Balanced character class for canonical preset IDs including combining marks & underscores. */
export const SAFE_CITY_ID_RE = /^[\p{L}\p{N}(][\p{L}\p{M}\p{N}_ .\-()]{1,63}$/u;

const CITATION_PREFIX_RE = /\s*(?:CALC|SCI|AQ|POLICY|PRESET)\s*:/iy;

const UNSAFE_CHARS = new Set(['<', '>', '[', ']', '{', '}', '\\', ';', '|']);

const UNSAFE_QUERY_RE = new RegExp(
  'https?:\\/\\/|file:\\/\\/|ftp:\\/\\/|data:|gopher:|ldap:|dict:|'
    + '169\\.254\\.|127\\.0\\.0\\.1|0\\.0\\.0\\.0|10\\.\\d{1,3}\\.|'
    + '172\\.(?:1[6-9]|2\\d|3[01])\\.|192\\.168\\.|localhost|::1|\\[::1\\]|'
    + '::ffff:|\\[?fe80:|metadata\\.google\\.internal',
  'i',
);

function isZeroWidthOrBidiCode(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) ||
    code === 0xfeff
  );
}

/**
 * Strips zero-width formatting and bidirectional override characters via charCode checks.
 */
export function stripZeroWidthAndBidi(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i);
    if (!isZeroWidthOrBidiCode(code)) {
      out += raw[i] ?? '';
    }
  }
  return out;
}

/** Visits innermost bracket tags in a single scan of the input. */
export function scanBracketTags(
  text: string,
  visit: (key: string, start: number, end: number) => void,
): void {
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') start = i;
    if (text[i] === ']' && start >= 0) {
      visit(text.slice(start + 1, i), start, i + 1);
      start = -1;
    }
  }
}

/** Removes citation-shaped bracket tags unless their exact key is allowlisted. */
export function stripCitationTags(raw: string, allowed?: ReadonlySet<string>): string {
  const chunks: string[] = [];
  let cursor = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '[') continue;
    CITATION_PREFIX_RE.lastIndex = i + 1;
    if (!CITATION_PREFIX_RE.test(raw)) continue;
    const end = skipCitation(raw, i + 1);
    const key = raw.slice(i + 1, end);
    if (end === raw.length || !allowed?.has(key)) {
      chunks.push(raw.slice(cursor, i), ' ');
      cursor = end + 1;
    }
    i = end;
  }
  return chunks.length === 0 ? raw : chunks.join('') + raw.slice(cursor);
}

function skipCitation(raw: string, start: number): number {
  let depth = 1;
  for (let i = start; i < raw.length; i++) {
    if (raw[i] === '[') depth += 1;
    if (raw[i] === ']') depth -= 1;
    if (depth === 0) return i;
  }
  return raw.length;
}

/**
 * Normalizes and sanitizes untrusted location text for safe display and storage.
 */
export function sanitizeLocationText(raw: string): string {
  const normalized = stripZeroWidthAndBidi(raw.normalize('NFKC'));
  const withoutTags = stripCitationTags(normalized);
  return withoutTags
    .replace(/[^\p{L}\p{M}\p{N} .\-()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

/**
 * Escapes XML special characters (`&`, `<`, `>`, `"`, `'`).
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\x22/g, '&quot;')
    .replace(/\x27/g, '&apos;');
}

const EXCESS_COMBINING_MARKS_RE = /\p{M}{4,}/u;

/**
 * Detects URLs, private/metadata SSRF targets, control characters, and delimiters.
 */
export function isUnsafeLocationQuery(raw: string): boolean {
  const normalized = stripZeroWidthAndBidi(raw.normalize('NFKC'));
  for (let i = 0; i < normalized.length; i += 1) {
    const code = normalized.charCodeAt(i);
    const ch = normalized[i] ?? '';
    if (code < 32 || code === 127 || UNSAFE_CHARS.has(ch)) {
      return true;
    }
  }
  return EXCESS_COMBINING_MARKS_RE.test(normalized) || UNSAFE_QUERY_RE.test(normalized);
}

/**
 * Canonical validator for city names and preset IDs (e.g., `delhi_anand_vihar`).
 */
export function isUnsafeCityInput(rawCity: string): boolean {
  const nfkc = rawCity.normalize('NFKC');
  if (stripZeroWidthAndBidi(nfkc) !== nfkc) {
    return true;
  }
  const trimmed = nfkc.trim();
  if (trimmed.length === 0 || isUnsafeLocationQuery(trimmed)) {
    return true;
  }
  return !SAFE_CITY_ID_RE.test(trimmed);
}
