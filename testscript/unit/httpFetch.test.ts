import { afterEach, expect, it, vi } from 'vitest';
import { fetchBoundedJsonDetailed } from '../../server/services/httpFetch.js';

const endpoint = 'https://example.invalid/fixture';

afterEach(() => vi.restoreAllMocks());

it('retries transient gateway errors once under the same abort deadline', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(fetchBoundedJsonDetailed(endpoint, 1000))
    .resolves.toEqual({ ok: true, data: { ok: true } });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(fetcher.mock.calls[1]?.[1]?.signal);
});

it('takes caller cancellation without attempting a second read', async () => {
  const controller = new AbortController();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_, init) => {
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return Response.json({});
  });
  controller.abort();
  await expect(fetchBoundedJsonDetailed(endpoint, 1000, 256, controller.signal))
    .resolves.toEqual({ ok: false, reason: 'aborted' });
});

it('rejects a lookalike JSON content type without retry', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}', { headers: { 'content-type': 'text/application/json' } }));
  await expect(fetchBoundedJsonDetailed(endpoint, 1000))
    .resolves.toEqual({ ok: false, reason: 'content_type' });
  expect(fetcher).toHaveBeenCalledOnce();
});
