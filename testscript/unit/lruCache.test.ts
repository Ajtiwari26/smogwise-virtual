import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLruCache,
  createSingleflight,
  hashCacheKey,
} from '../../server/cache/lruCache.js';

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

  it('handles undefined, Date, RegExp, Set, Map, BigInt, -0, NaN, and circular refs distinctly', () => {
    expect(hashCacheKey(undefined)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCacheKey(undefined)).not.toBe(hashCacheKey(null));

    const d1 = hashCacheKey(new Date('2026-01-01T00:00:00.000Z'));
    const d2 = hashCacheKey(new Date('2026-01-02T00:00:00.000Z'));
    expect(d1).not.toBe(d2);

    expect(hashCacheKey(/abc/i)).not.toBe(hashCacheKey(/abc/g));
    expect(hashCacheKey(new Set([2, 1]))).toBe(hashCacheKey(new Set([1, 2])));
    expect(hashCacheKey(new Map([['a', 1]]))).not.toBe(hashCacheKey(new Map([['a', 2]])));
    expect(hashCacheKey(42n)).not.toBe(hashCacheKey('42'));
    expect(hashCacheKey(-0)).toBe(hashCacheKey(0));
    expect(hashCacheKey(Number.NaN)).not.toBe(hashCacheKey(Number.POSITIVE_INFINITY));

    const circular: Record<string, unknown> = { tag: 'loop' };
    circular['self'] = circular;
    expect(hashCacheKey(circular)).toMatch(/^[a-f0-9]{64}$/);
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

  it('guards NaN capacity, ttlMs=0 eviction, delete/clear, and singleflight sync-throw/clear races', async () => {
    const fallbackCache = createLruCache<string>(Number.NaN, Number.NaN);
    expect(fallbackCache.getStats().maxEntries).toBe(200);

    fallbackCache.set('temp', 'value');
    expect(fallbackCache.get('temp')).toBe('value');
    fallbackCache.set('temp', 'evicted', 0);
    expect(fallbackCache.get('temp')).toBeUndefined();

    fallbackCache.set('a', '1');
    expect(fallbackCache.delete('a')).toBe(true);
    expect(fallbackCache.delete('a')).toBe(false);
    fallbackCache.set('b', '2');
    fallbackCache.clear();
    expect(fallbackCache.getStats()).toEqual({ hits: 0, misses: 0, size: 0, maxEntries: 200 });

    const sf = createSingleflight<string>(Number.NaN);
    await expect(
      sf.run('sync-err', () => {
        throw new Error('sync boom');
      }),
    ).rejects.toThrow('sync boom');

    let finishFirst!: (v: string) => void;
    const p1 = sf.run('race', () => new Promise<string>((r) => { finishFirst = r; }));
    sf.clear();
    let finishSecond!: (v: string) => void;
    const p2 = sf.run('race', () => new Promise<string>((r) => { finishSecond = r; }));
    const p2Join = sf.run('race', async () => 'unexpected');
    expect(p2Join).toBe(p2);

    finishFirst('first');
    expect(await p1).toBe('first');
    finishSecond('second');
    expect(await p2).toBe('second');
  });
});
