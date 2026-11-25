import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import {
  clearGeocodingCache,
  searchIndianLocations,
} from '../../server/services/geocodingClient.js';
import {
  clearAirQualityCache,
  fetchAirQualityForCity,
} from '../../server/services/openMeteoClient.js';

const VALID_PROFILE = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: false,
  monthlyBudgetInr: 15000,
  roomVolumeM3: 90,
  commuteMode: 'metro_bus',
  commuteDistanceKm: 15,
  cookingFuel: 'lpg',
  activeHacks: ['wet_mopping'],
};

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockUpstreamApis(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('geocoding-api.open-meteo.com')) {
      return makeJsonResponse({
        results: [
          {
            name: 'Bhopal',
            latitude: 23.2599,
            longitude: 77.4126,
            admin1: 'Madhya Pradesh',
            country_code: 'IN',
          },
        ],
      });
    }
    return makeJsonResponse({
      current: { time: '2026-11-25T15:10', pm2_5: 160, pm10: 270, nitrogen_dioxide: 52 },
    });
  });
}

describe('Singleflight coalescing', () => {
  afterEach(() => {
    clearAirQualityCache();
    clearGeocodingCache();
    vi.restoreAllMocks();
  });

  it('coalesces concurrent fetchAirQualityForCity calls into 1 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      makeJsonResponse({
        current: { time: '2026-11-25T15:00', pm2_5: 185, pm10: 310, nitrogen_dioxide: 64 },
      }),
    );

    const results = await Promise.all([
      fetchAirQualityForCity('delhi_anand_vihar'),
      fetchAirQualityForCity('delhi_anand_vihar'),
      fetchAirQualityForCity('delhi_anand_vihar'),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results[0]?.liveAq?.pm25).toBe(185);
    expect(results[1]?.liveAq?.pm25).toBe(185);
  });

  it('coalesces concurrent searchIndianLocations calls into 1 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      makeJsonResponse({
        results: [
          {
            name: 'Indore',
            latitude: 22.7196,
            longitude: 75.8577,
            admin1: 'Madhya Pradesh',
            country_code: 'IN',
          },
        ],
      }),
    );

    const results = await Promise.all([
      searchIndianLocations('Indore'),
      searchIndianLocations('Indore'),
      searchIndianLocations('Indore'),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(results[0]).toHaveLength(1);
    expect(results[0]?.[0]?.name).toBe('Indore');
  });
});

describe('Transient failure recovery', () => {
  afterEach(() => {
    clearAirQualityCache();
    clearGeocodingCache();
    vi.restoreAllMocks();
  });

  it('does not poison caches after transient fetch failures', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(
        makeJsonResponse({
          current: { time: '2026-11-25T15:05', pm2_5: 142, pm10: 240, nitrogen_dioxide: 48 },
        }),
      )
      .mockRejectedValueOnce(new Error('dns failure'))
      .mockResolvedValueOnce(
        makeJsonResponse({
          results: [
            {
              name: 'Nagpur',
              latitude: 21.1458,
              longitude: 79.0882,
              admin1: 'Maharashtra',
              country_code: 'IN',
            },
          ],
        }),
      );

    expect((await fetchAirQualityForCity('mumbai_bandra')).liveAq).toBeUndefined();
    expect((await fetchAirQualityForCity('mumbai_bandra')).liveAq?.pm25).toBe(142);
    expect(await searchIndianLocations('Nagpur')).toEqual([]);
    expect((await searchIndianLocations('Nagpur'))[0]?.name).toBe('Nagpur');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe('Cache-Control headers and offline briefing fallback', () => {
  afterEach(() => {
    clearAirQualityCache();
    clearGeocodingCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('sets expected Cache-Control headers on public vs private endpoints', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    mockUpstreamApis();
    const app = createApp();

    const cityAqi = await request(app).get('/api/aqi?city=delhi');
    expect(cityAqi.status).toBe(200);
    expect(cityAqi.headers['cache-control']).toContain('public, s-maxage=300');

    const coordsAqi = await request(app).get('/api/aqi?lat=28.6139&lon=77.209');
    expect(coordsAqi.status).toBe(200);
    expect(coordsAqi.headers['cache-control']).toBe('private, no-store');

    const locSearch = await request(app).get('/api/locations/search?q=Bhopal');
    expect(locSearch.status).toBe(200);
    expect(locSearch.headers['cache-control']).toBe('private, no-store');

    const planRes = await request(app).post('/api/plan').send(VALID_PROFILE);
    expect(planRes.status).toBe(200);
    expect(planRes.headers['cache-control']).toBe('private, no-store');

    const briefingRes = await request(app).post('/api/plan/briefing').send(VALID_PROFILE);
    expect(briefingRes.status).toBe(200);
    expect(briefingRes.headers['cache-control']).toBe('private, no-store');

    const aiAskRes = await request(app)
      .post('/api/ai/ask')
      .send({ question: 'How do I reduce indoor PM2.5?', city: 'delhi' });
    expect(aiAskRes.status).toBe(200);
    expect(aiAskRes.headers['cache-control']).toBe('private, no-store');
  });

  it('returns deterministic whyActions and citationsUsed on offline POST /api/plan/briefing', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const app = createApp();
    const res = await request(app).post('/api/plan/briefing').send(VALID_PROFILE);

    expect(res.status).toBe(200);
    const body = res.body as {
      readonly whyActions?: readonly string[];
      readonly citationsUsed?: readonly string[];
    };
    expect((body.whyActions ?? []).length).toBeGreaterThan(0);
    expect((body.citationsUsed ?? []).length).toBeGreaterThan(0);
  });
});
