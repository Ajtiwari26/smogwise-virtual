/**
 * Generic SHA-256 keyed LRU cache with TTL expiry and hit/miss statistics.
 */

import crypto from 'node:crypto';

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 15 * 60 * 1000;

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

function canonicalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      const item = record[key];
      if (item !== undefined) {
        sorted[key] = canonicalizeValue(item);
      }
    }
    return sorted;
  }
  return value;
}

/**
 * Produces a deterministic SHA-256 hex digest for any JSON-serializable input.
 */
export function hashCacheKey(input: unknown): string {
  const canonical = JSON.stringify(canonicalizeValue(input));
  return crypto.createHash('sha256').update(canonical).digest('hex');
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
   * Creates a bounded LRU cache with default TTL in milliseconds.
   */
  constructor(maxEntries = DEFAULT_MAX_ENTRIES, defaultTtlMs = DEFAULT_TTL_MS) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.defaultTtlMs = Math.max(1, Math.floor(defaultTtlMs));
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

  /**
   * Stores a value with optional custom TTL and evicts the oldest entry if full.
   */
  set(key: string, value: T, ttlMs?: number): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    const effectiveTtl = ttlMs !== undefined && ttlMs > 0 ? ttlMs : this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl,
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
