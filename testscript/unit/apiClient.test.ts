import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '../../src/domain/types.js';
import {
  ApiError,
  fetchAqi,
  fetchAqiByCoords,
  postAiAsk,
  postPlan,
  postPlanBriefing,
  postWhatIf,
  searchLocations,
} from '../../src/services/apiClient.js';

const sampleProfile: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: false,
  monthlyBudgetInr: 3000,
  roomVolumeM3: 110,
  commuteMode: 'petrol_car',
  commuteDistanceKm: 20,
  cookingFuel: 'lpg',
  activeHacks: ['wet_mopping'],
  rwaHouseholds: 50,
  rwaAdoptionRate: 0.3,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('apiClient GET endpoints', () => {
  it('fetches AQI by city id and forwards AbortSignal', async () => {
    const payload = { cpcbAqi: 185, dataSource: 'live_open_meteo' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const res = await fetchAqi('new delhi', controller.signal);
    expect(res).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith('/api/aqi?city=new%20delhi', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  });

  it('fetches AQI by coords with trimmed optional name and state', async () => {
    const payload = { cpcbAqi: 92, dataSource: 'city_preset' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchAqiByCoords(23.2599, 77.4126, ' Bhopal ', '  ');
    expect(res).toEqual(payload);
    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('lat=23.2599');
    expect(calledUrl).toContain('lon=77.4126');
    expect(calledUrl).toContain('name=Bhopal');
    expect(calledUrl).not.toContain('state=');
  });

  it('searches locations and returns results array', async () => {
    const items = [{ id: 'delhi', name: 'Delhi', state: 'Delhi' }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: items }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await searchLocations('del');
    expect(res).toEqual(items);
    expect(fetchMock).toHaveBeenCalledWith('/api/locations/search?q=del', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

describe('apiClient POST endpoints', () => {
  it('posts plan, plan briefing, what-if, and ai ask payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ planId: 'p1' }))
      .mockResolvedValueOnce(jsonResponse({ headline: 'Act today' }))
      .mockResolvedValueOnce(jsonResponse({ deltaCo2e: -12 }))
      .mockResolvedValueOnce(jsonResponse({ answer: 'Use N95' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(postPlan(sampleProfile)).resolves.toEqual({ planId: 'p1' });
    await expect(postPlanBriefing(sampleProfile)).resolves.toEqual({ headline: 'Act today' });
    const altProfile: UserProfile = { ...sampleProfile, commuteDistanceKm: 5 };
    await expect(postWhatIf(sampleProfile, altProfile)).resolves.toEqual({
      deltaCo2e: -12,
    });
    await expect(postAiAsk('Mask advice?', sampleProfile)).resolves.toEqual({ answer: 'Use N95' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('apiClient error handling', () => {
  it('throws ApiError preserving status and code on non-OK JSON response', async () => {
    const errBody = { error: 'RATE_LIMITED', message: 'Too many requests' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(errBody, 429)));

    await expect(fetchAqi('delhi')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many requests',
    });
  });

  it('falls back to status message when error response is invalid JSON', async () => {
    const badRes = new Response('<html>502 Bad Gateway</html>', { status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(badRes));

    let caught: unknown;
    try {
      await postPlan(sampleProfile);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(502);
    expect((caught as ApiError).code).toBeUndefined();
    expect((caught as ApiError).message).toBe('Request failed with status 502');
  });

  it('propagates AbortError when fetch rejects on cancellation', async () => {
    const abortErr = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortErr));
    const controller = new AbortController();
    controller.abort();

    await expect(postAiAsk('Hello', sampleProfile, controller.signal)).rejects.toBe(abortErr);
  });
});
