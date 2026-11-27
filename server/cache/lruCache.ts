/**
 * Generic SHA-256 keyed LRU cache with TTL expiry, canonical hashing,
 * and bounded singleflight coalescing.
 */

import crypto from 'node:crypto';
import { isPlainRecord } from '../../src/domain/domainUtils.js';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_INFLIGHT = 100;

interface CacheEntry<T> {
  readonly value: T;
  readonly expiresAt: number;
}

/** Runtime statistics for an LruCache instance. */
export interface LruCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
  readonly maxEntries: number;
}

/** Bounded singleflight coalescer that deduplicates concurrent async work by key. */
export interface Singleflight<T> {
  run(key: string, work: () => Promise<T>): Promise<T>;
  clear(): void;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function serializeSpecialObject(value: object, seen: WeakSet<object>): string | undefined {
  if (value instanceof Date) {
    const iso = Number.isNaN(value.getTime()) ? 'InvalidDate' : value.toISOString();
    return `{"__type":"Date","value":${JSON.stringify(iso)}}`;
  }
  if (value instanceof RegExp) {
    return `{"__type":"RegExp","source":${JSON.stringify(value.source)},"flags":${JSON.stringify(value.flags)}}`;
  }
  if (value instanceof Set) {
    const items = [...value].map((item) => serializeCanonical(item, seen)).sort(compareStrings);
    return `{"__type":"Set","values":${JSON.stringify(items)}}`;
  }
  if (value instanceof Map) {
    const entries: Array<readonly [string, string]> = [...value.entries()]
      .map(([k, v]): readonly [string, string] => [
        serializeCanonical(k, seen),
        serializeCanonical(v, seen),
      ])
      .sort((a, b) => compareStrings(a[0], b[0]));
    return `{"__type":"Map","entries":[${entries.map(([k, v]) => `[${k},${v}]`).join(',')}]}`;
  }
  return undefined;
}

function serializeScalar(value: unknown): string {
  if (value === undefined) return '{"__type":"Undefined"}';
  if (typeof value === 'bigint') {
    return `{"__type":"BigInt","value":${JSON.stringify(value.toString())}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return `{"__type":"NonFiniteNumber","value":${JSON.stringify(String(value))}}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return JSON.stringify(value);
  }
  return JSON.stringify(String(value));
}

function serializePlainRecord(value: Record<string, unknown>, seen: WeakSet<object>): string {
  const keys = Object.keys(value).sort(compareStrings);
  const parts: string[] = [];
  for (const key of keys) {
    const item = value[key];
    if (item !== undefined) parts.push(`${JSON.stringify(key)}:${serializeCanonical(item, seen)}`);
  }
  return `{${parts.join(',')}}`;
}

function serializeObject(value: object, seen: WeakSet<object>): string {
  if (seen.has(value)) return '"[Circular]"';
  seen.add(value);
  try {
    const special = serializeSpecialObject(value, seen);
    if (special !== undefined) return special;
    if (Array.isArray(value)) {
      return `[${value.map((item) => serializeCanonical(item, seen)).join(',')}]`;
    }
    if (isPlainRecord(value)) return serializePlainRecord(value, seen);
    return JSON.stringify(String(value));
  } finally {
    seen.delete(value);
  }
}

function serializeCanonical(value: unknown, seen = new WeakSet<object>()): string {
  if (value !== null && typeof value === 'object') {
    return serializeObject(value, seen);
  }
  return serializeScalar(value);
}

/**
 * Produces a deterministic SHA-256 hex digest for any input, including undefined,
 * Dates, Sets, Maps, RegExps, BigInts, non-finite numbers, and circular structures.
 */
export function hashCacheKey(input: unknown): string {
  const canonical = serializeCanonical(input);
  return typeof crypto.hash === 'function'
    ? crypto.hash('sha256', canonical)
    : crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * In-memory Least Recently Used (LRU) cache with per-entry TTL expiration.
 */
export class LruCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private hits = 0;
  private misses = 0;

  /**
   * Creates a bounded LRU cache with finite positive capacity and default TTL in ms.
   */
  constructor(maxEntries = DEFAULT_MAX_ENTRIES, defaultTtlMs = DEFAULT_TTL_MS) {
    this.maxEntries = Number.isFinite(maxEntries)
      ? Math.max(1, Math.floor(maxEntries))
      : DEFAULT_MAX_ENTRIES;
    this.defaultTtlMs = Number.isFinite(defaultTtlMs)
      ? Math.max(1, Math.floor(defaultTtlMs))
      : DEFAULT_TTL_MS;
  }

  /**
   * Retrieves a non-expired value and refreshes its recency, or returns undefined.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return entry.value;
  }

  private evictOrReplace(key: string): void {
    if (this.store.has(key)) {
      this.store.delete(key);
      return;
    }
    if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
  }

  private resolveTtlMs(ttlMs: number | undefined): number {
    if (ttlMs !== undefined && Number.isFinite(ttlMs) && ttlMs > 0) {
      return Math.floor(ttlMs);
    }
    return this.defaultTtlMs;
  }

  /**
   * Stores a value with optional custom TTL and evicts the oldest entry if full.
   * Passing ttlMs === 0 immediately expires (evicts) any entry for that key.
   */
  set(key: string, value: T, ttlMs?: number): void {
    if (ttlMs !== undefined && Number.isFinite(ttlMs) && ttlMs <= 0) {
      this.store.delete(key);
      return;
    }
    this.evictOrReplace(key);
    this.store.set(key, {
      value,
      expiresAt: Date.now() + this.resolveTtlMs(ttlMs),
    });
  }

  /**
   * Deletes a single key from the cache.
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Clears all cached entries and resets hit/miss counters.
   */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Returns current hit/miss counters and capacity metrics.
   */
  getStats(): LruCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      maxEntries: this.maxEntries,
    };
  }
}

/**
 * Factory helper to create a typed LruCache instance.
 */
export function createLruCache<T>(
  maxEntries = DEFAULT_MAX_ENTRIES,
  defaultTtlMs = DEFAULT_TTL_MS,
): LruCache<T> {
  return new LruCache<T>(maxEntries, defaultTtlMs);
}

/**
 * Creates a bounded singleflight map that shares an in-flight promise per key
 * and removes entries once settled without clobbering newer runs after clear().
 */
export function createSingleflight<T>(maxInFlight = DEFAULT_MAX_INFLIGHT): Singleflight<T> {
  const limit = Number.isFinite(maxInFlight)
    ? Math.max(1, Math.floor(maxInFlight))
    : DEFAULT_MAX_INFLIGHT;
  const inFlight = new Map<string, Promise<T>>();
  return {
    run(key: string, work: () => Promise<T>): Promise<T> {
      const existing = inFlight.get(key);
      if (existing !== undefined) {
        return existing;
      }
      let workPromise: Promise<T>;
      try {
        workPromise = Promise.resolve(work());
      } catch (err: unknown) {
        return Promise.reject(err);
      }
      const promise = workPromise.finally(() => {
        if (inFlight.get(key) === promise) {
          inFlight.delete(key);
        }
      });
      if (inFlight.size < limit) {
        inFlight.set(key, promise);
      }
      return promise;
    },
    clear(): void {
      inFlight.clear();
    },
  };
}
