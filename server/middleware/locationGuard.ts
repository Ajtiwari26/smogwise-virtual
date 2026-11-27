/**
 * Zod validation schemas and SSRF guards for location search and AQI lookup endpoints.
 */

import { z } from 'zod';
import { INDIA_BOUNDS } from '../../src/domain/cityPresets.js';
import {
  isUnsafeLocationQuery,
  SAFE_CITY_ID_RE,
  SAFE_CITY_RE,
  sanitizeLocationText,
} from './textSanitizer.js';

/** Re-exported XML escaping helper for prompt isolation. */
export { escapeXml } from './textSanitizer.js';
/** Re-exported canonical preset/city input validator. */
export { isUnsafeCityInput } from './textSanitizer.js';
/** Re-exported untrusted location label sanitizer. */
export { sanitizeLocationText } from './textSanitizer.js';
/** Re-exported bracket citation tag stripper. */
export { stripCitationTags } from './textSanitizer.js';
/** Re-exported zero-width and BiDi Unicode stripper. */
export { stripZeroWidthAndBidi } from './textSanitizer.js';

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
  if (data.city !== undefined && data.cityId !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Cannot specify both city and cityId.',
      path: ['city'],
    });
    return;
  }
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
      .refine((s) => !isUnsafeLocationQuery(s), 'Unsafe location name')
      .transform((s) => sanitizeLocationText(s))
      .refine((s) => s.length >= 1, 'Invalid location name'),
    state: z
      .string()
      .refine((s) => !isUnsafeLocationQuery(s), 'Unsafe location state')
      .transform((s) => sanitizeLocationText(s))
      .optional(),
    lat: z.number().finite().min(INDIA_BOUNDS.latMin).max(INDIA_BOUNDS.latMax),
    lon: z.number().finite().min(INDIA_BOUNDS.lonMin).max(INDIA_BOUNDS.lonMax),
  })
  .strict();
