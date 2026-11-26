/**
 * Input validation, XML escaping, and SSRF/injection guards for location
 * search and AQI lookup endpoints.
 */

import { z } from 'zod';
import { INDIA_BOUNDS } from '../../src/domain/cityPresets.js';

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
  'https?:\\/\\/|file:\\/\\/|ftp:\\/\\/|169\\.254\\.|127\\.0\\.0\\.1|'
    + 'localhost|::1|metadata\\.google\\.internal|169\\.254\\.169\\.254',
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
 * Detects URLs, SSRF targets, control characters, and delimiter injection characters.
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

/** Zod schema validating GET /api/locations/search query parameter `q`. */
export const LocationSearchQuerySchema = z
  .object({
    q: z
      .string()
      .transform((s) => s.normalize('NFKC').trim())
      .refine((s) => s.length >= 2 && s.length <= 64, 'Query must be 2 to 64 chars')
      .refine((s) => !isUnsafeLocationQuery(s), 'Unsafe location query')
      .refine((s) => SAFE_CITY_RE.test(s), 'Unsupported characters in location query'),
  })
  .strict();

/** Strict decimal coordinate parser without `z.coerce.number()`. */
export const StrictCoordSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,3}(?:\.\d{1,6})?$/)
  .transform(Number)
  .pipe(z.number().finite());



const OptionalSafeLabelSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').trim())
  .refine((s) => !isUnsafeLocationQuery(s), 'Unsafe location label')
  .refine((s) => SAFE_CITY_RE.test(s), 'Unsupported characters in location label');

const OptionalCityIdSchema = z
  .string()
  .transform((s) => s.normalize('NFKC').trim())
  .refine((s) => !isUnsafeLocationQuery(s), 'Unsafe city ID')
  .refine((s) => SAFE_CITY_ID_RE.test(s), 'Unsupported characters in city ID');

interface BoundSpec {
  readonly raw: string;
  readonly min: number;
  readonly max: number;
  readonly field: 'lat' | 'lon';
  readonly label: string;
}

function validateIndiaCoord(spec: BoundSpec, ctx: z.RefinementCtx): void {
  const parsed = StrictCoordSchema.safeParse(spec.raw);
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid ${spec.label} format.`,
      path: [spec.field],
    });
    return;
  }
  if (parsed.data < spec.min || parsed.data > spec.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${spec.label} must be within India bounds (${spec.min} to ${spec.max}).`,
      path: [spec.field],
    });
  }
}

interface AqiQueryFields {
  readonly city?: string | undefined;
  readonly cityId?: string | undefined;
  readonly lat?: string | undefined;
  readonly lon?: string | undefined;
}

function validateAqiPair(
  lat: string | undefined,
  lon: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (lat === undefined || lon === undefined) {
    return;
  }
  validateIndiaCoord(
    {
      raw: lat,
      min: INDIA_BOUNDS.latMin,
      max: INDIA_BOUNDS.latMax,
      field: 'lat',
      label: 'Latitude',
    },
    ctx,
  );
  validateIndiaCoord(
    {
      raw: lon,
      min: INDIA_BOUNDS.lonMin,
      max: INDIA_BOUNDS.lonMax,
      field: 'lon',
      label: 'Longitude',
    },
    ctx,
  );
}

function validateAqiQuery(data: AqiQueryFields, ctx: z.RefinementCtx): void {
  const hasCity = data.city !== undefined || data.cityId !== undefined;
  const hasLat = data.lat !== undefined;
  const hasLon = data.lon !== undefined;

  if (hasCity && (hasLat || hasLon)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cannot specify city or cityId together with lat or lon.',
      path: ['city'],
    });
    return;
  }

  if (hasLat !== hasLon) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Both lat and lon must be provided together.',
      path: [hasLat ? 'lon' : 'lat'],
    });
    return;
  }

  validateAqiPair(data.lat, data.lon, ctx);
}

/** Zod schema validating GET /api/aqi query parameters. */
export const AqiQuerySchema = z
  .object({
    city: OptionalCityIdSchema.optional(),
    cityId: OptionalCityIdSchema.optional(),
    lat: z.string().optional(),
    lon: z.string().optional(),
    name: OptionalSafeLabelSchema.optional(),
    state: OptionalSafeLabelSchema.optional(),
  })
  .strict()
  .superRefine(validateAqiQuery);

/** Zod schema validating user-selected custom map coordinates inside India. */
export const CustomLocationSchema = z
  .object({
    name: z
      .string()
      .transform((s) => sanitizeLocationText(s))
      .refine((s) => s.length >= 1, 'Invalid location name'),
    state: z
      .string()
      .transform((s) => sanitizeLocationText(s))
      .optional(),
    lat: z.number().finite().min(INDIA_BOUNDS.latMin).max(INDIA_BOUNDS.latMax),
    lon: z.number().finite().min(INDIA_BOUNDS.lonMin).max(INDIA_BOUNDS.lonMax),
  })
  .strict();
