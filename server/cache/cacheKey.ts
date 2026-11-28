/** Canonical cache-key encoding for structured request data. */

import crypto from 'node:crypto';
import { isPlainRecord } from '../../src/domain/domainUtils.js';

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serializeSpecialObject(value: object, seen: Map<object, number>): string | undefined {
  if (value instanceof Date) {
    const iso = Number.isNaN(value.getTime()) ? 'InvalidDate' : value.toISOString();
    return `!D${JSON.stringify(iso)}`;
  }
  if (value instanceof RegExp) {
    return `!R${JSON.stringify([value.source, value.flags])}`;
  }
  if (value instanceof Set) {
    const items = [...value].map((item) => serializeCanonical(item, seen)).sort(compareStrings);
    return `!S[${items.join(',')}]`;
  }
  if (value instanceof Map) {
    const entries: Array<readonly [string, string]> = [...value.entries()]
      .map(([k, v]): readonly [string, string] => [
        serializeCanonical(k, seen),
        serializeCanonical(v, seen),
      ])
      .sort((a, b) => compareStrings(a[0], b[0]) || compareStrings(a[1], b[1]));
    return `!M[${entries.map(([k, v]) => `[${k},${v}]`).join(',')}]`;
  }
  return undefined;
}

function hasEscapableChar(str: string): boolean {
  for (let i = 0; i < str.length; i += 1) {
    const code = str.charCodeAt(i);
    if (code < 0x20 || code === 0x22 || code === 0x5c || (code >= 0xd800 && code <= 0xdfff)) {
      return true;
    }
  }
  return false;
}

function quoteStringFast(str: string): string {
  return hasEscapableChar(str) ? JSON.stringify(str) : `"${str}"`;
}

function serializeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return `!N"${String(value)}"`;
  }
  return String(value === 0 ? 0 : value);
}

function serializeScalar(value: unknown): string {
  if (typeof value === 'string') return quoteStringFast(value);
  if (typeof value === 'number') return serializeNumber(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  if (value === undefined) return '!U';
  if (typeof value === 'bigint') return `!I"${value.toString()}"`;
  throw new TypeError('Unsupported cache-key value.');
}

function serializePlainRecord(value: Record<string, unknown>, seen: Map<object, number>): string {
  const keys = Object.keys(value).sort();
  let out = '{';
  let first = true;
  for (const key of keys) {
    const item = value[key];
    if (item === undefined) continue;
    if (!first) out += ',';
    first = false;
    out += `${quoteStringFast(key)}:${serializeCanonical(item, seen)}`;
  }
  return `${out}}`;
}

function serializeArray(value: readonly unknown[], seen: Map<object, number>): string {
  let out = '[';
  for (let i = 0; i < value.length; i += 1) {
    if (i > 0) out += ',';
    out += Object.hasOwn(value, i) ? serializeCanonical(value[i], seen) : '!H';
  }
  return `${out}]`;
}

function isRecordPrototype(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function serializeObject(value: object, seen: Map<object, number>): string {
  const reference = seen.get(value);
  if (reference !== undefined) return `!C${reference}`;
  seen.set(value, seen.size);
  try {
    const special = serializeSpecialObject(value, seen);
    if (special !== undefined) return special;
    if (Array.isArray(value)) return serializeArray(value, seen);
    if (isPlainRecord(value) && isRecordPrototype(value)) return serializePlainRecord(value, seen);
    throw new TypeError('Unsupported cache-key value.');
  } finally {
    seen.delete(value);
  }
}

function serializeCanonical(value: unknown, seen?: Map<object, number>): string {
  if (value !== null && typeof value === 'object') {
    return serializeObject(value, seen ?? new Map<object, number>());
  }
  return serializeScalar(value);
}

/**
 * Hashes plain data using ordered keys and reserved type tags for undefined,
 * Dates, Sets, Maps, RegExps, BigInts, non-finite numbers, and circular structures.
 */
export function hashCacheKey(input: unknown): string {
  const canonical = serializeCanonical(input);
  return typeof crypto.hash === 'function'
    ? crypto.hash('sha256', canonical)
    : crypto.createHash('sha256').update(canonical).digest('hex');
}
