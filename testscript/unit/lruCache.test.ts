import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLruCache, hashCacheKey } from '../../server/cache/lruCache.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('hashCacheKey canonical determinism', () => {
  it('produces identical SHA-256 digests regardless of object key order', () => {
    const keyA = hashCacheKey({ city: 'delhi', nested: { b: 2, a: 1 }, list: [1, 2] });
    const keyB = hashCacheKey({ list: [1, 2], nested: { a: 1, b: 2 }, city: 'delhi' });

    expect(keyA).toBe(keyB);
    expect(keyA).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces distinct digests for different values', () => {
    const keyA = hashCacheKey({ city: 'delhi', budget: 1200 });
    const keyB = hashCacheKey({ city: 'delhi', budget: 6000 });
    expect(keyA).not.toBe(keyB);
  });
});

describe('LruCache eviction & TTL expiry', () => {
  it('evicts the least recently used entry when maxEntries=2 is exceeded', () => {
    const cache = createLruCache<string>(2, 60_000);
    cache.set('k1', 'v1');
    cache.set('k2', 'v2');

    // Touch k1 so k2 becomes least recently used
    expect(cache.get('k1')).toBe('v1');
    cache.set('k3', 'v3');

    expect(cache.get('k2')).toBeUndefined();
    expect(cache.get('k1')).toBe('v1');
    expect(cache.get('k3')).toBe('v3');
    expect(cache.getStats().size).toBe(2);
  });

  it('expires entries after TTL using fake timers', () => {
    vi.useFakeTimers();
    const cache = createLruCache<number>(5, 1_000);
    cache.set('aqi', 285);
    expect(cache.get('aqi')).toBe(285);

    vi.advanceTimersByTime(1_001);
    expect(cache.get('aqi')).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
  });
});
