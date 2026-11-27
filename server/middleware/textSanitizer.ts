/**
 * Unicode BiDi/zero-width normalization, citation tag stripping, XML escaping,
 * and SSRF/injection detection helpers for location queries and identifiers.
 */

/** Balanced character class for safe city names (no escaped brackets). */
export const SAFE_CITY_RE = /^[\p{L}\p{N} .\-()]{1,64}$/u;

/** Balanced character class for canonical preset IDs (allows underscore). */
export const SAFE_CITY_ID_RE = /^[\p{L}\p{N}_ .\-()]{2,64}$/u;

const CITATION_PREFIXES = [
  '[CALC:',
  '[SCI:',
  '[AQ:',
  '[POLICY:',
  '[PRESET:',
] as const;

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

/**
 * Strips structured citation tags such as `[CALC:...]`, `[SCI:...]`, `[AQ:...]`,
 * `[POLICY:...]`, or `[PRESET:...]` without using escaped bracket regex literals.
 */
export function stripCitationTags(raw: string): string {
  let result = raw;
  let searchFrom = 0;

  while (searchFrom < result.length) {
    const openIdx = result.indexOf('[', searchFrom);
    if (openIdx === -1) {
      break;
    }
    const closeIdx = result.indexOf(']', openIdx + 1);
    if (closeIdx === -1) {
      break;
    }

    const segment = result.slice(openIdx, closeIdx + 1);
    const upperSegment = segment.toUpperCase();
    const isCitation = CITATION_PREFIXES.some((prefix) => upperSegment.startsWith(prefix));

    if (isCitation) {
      result = `${result.slice(0, openIdx)} ${result.slice(closeIdx + 1)}`;
      searchFrom = openIdx;
    } else {
      searchFrom = closeIdx + 1;
    }
  }

  return result;
}

/**
 * Normalizes and sanitizes untrusted location text for safe display and storage.
 */
export function sanitizeLocationText(raw: string): string {
  const normalized = stripZeroWidthAndBidi(raw.normalize('NFKC'));
  const withoutTags = stripCitationTags(normalized);
  return withoutTags
    .replace(/[^\p{L}\p{N} .\-()]/gu, ' ')
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
  return UNSAFE_QUERY_RE.test(normalized);
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
