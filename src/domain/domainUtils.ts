/**
 * Pure math, rounding, clamping, and plain-record type-guard utilities.
 * Zero React, DOM, Node, or network dependencies.
 */

/** Rounds a finite numeric value to two decimal places. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 100) / 100;
}

/** Rounds a finite numeric value to four decimal places. */
export function round4(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(value * 10000) / 10000;
}

/** Clamps a numeric value to [min, max], returning fallback when non-finite. */
export function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

/** Clamps an optional household count to an integer within [0, maxHouseholds]. */
export function clampHouseholds(count: number | undefined, maxHouseholds: number): number {
  if (count === undefined) {
    return 0;
  }
  return Math.round(clampFinite(count, 0, maxHouseholds, 0));
}

/** Runtime type guard verifying an unknown value is a non-null, non-array object record. */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
