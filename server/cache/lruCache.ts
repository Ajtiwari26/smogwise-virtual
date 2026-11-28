/**
 * Generic SHA-256 keyed LRU cache with TTL expiry, canonical hashing,
 * and bounded singleflight coalescing.
 */

/** Re-exports canonical request and snapshot hashing. */
export { hashCacheKey } from './cacheKey.js';

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
  run(
    key: string, work: (isCurrent: () => boolean) => Promise<T>, onSaturated?: () => T,
  ): Promise<T>;
  clear(): void;
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
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }
    if (this.store.size > 1) {
      this.store.delete(key);
      this.store.set(key, entry);
    }
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
  let active = 0;
  return {
    run(key, work, onSaturated): Promise<T> {
      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;
      if (active >= limit) {
        return onSaturated === undefined
          ? Promise.reject(new Error('Singleflight capacity exhausted.'))
          : Promise.resolve().then(onSaturated);
      }
      active += 1;
      const isCurrent = (): boolean => inFlight.get(key) === promise;
      const promise: Promise<T> = Promise.resolve().then(() => work(isCurrent)).finally(() => {
        active -= 1;
        if (isCurrent()) inFlight.delete(key);
      });
      inFlight.set(key, promise);
      return promise;
    },
    clear(): void {
      inFlight.clear();
    },
  };
}
