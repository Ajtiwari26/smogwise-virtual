import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import { clearAirQualityCache } from '../../server/services/openMeteoClient.js';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';

const BASE_PROFILE = {
  persona: 'young_family',
  cityId: 'delhi',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: true,
  monthlyBudgetInr: 2500,
  roomVolumeM3: 45,
  commuteMode: 'metro_bus',
  commuteDistanceKm: 18,
  cookingFuel: 'lpg',
  activeHacks: ['window_sealing', 'wet_mopping', 'n95_mask'],
  rwaHouseholds: 100,
  rwaAdoptionRate: 0.4,
};

afterEach(() => {
  clearAirQualityCache();
  vi.restoreAllMocks();
});

describe('GET /api/health & /api/aqi', () => {
  it('returns 200 ok on /api/health', async () => {
    const res = await request(createApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns live_open_meteo data when mocked Open-Meteo succeeds', async () => {
    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          current: { pm2_5: 312, pm10: 420, nitrogen_dioxide: 68 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await request(createApp()).get('/api/aqi?cityId=delhi');
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe('live_open_meteo');
    expect(res.headers['cache-control']).toBe('public, s-maxage=300, stale-while-revalidate=600');
    expect(res.body.liveAq.pm25).toBe(312);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to city_preset when Open-Meteo fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const res = await request(createApp()).get('/api/aqi?cityId=lucknow');
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe('city_preset');
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body.city.baselinePm25).toBeGreaterThan(0);
  });
  it('falls back to city_preset when Open-Meteo returns unphysical/malformed JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ current: { pm2_5: -999 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const res = await request(createApp()).get('/api/aqi?cityId=patna');
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe('city_preset');
    expect(res.body.city.baselinePm25).toBeGreaterThan(0);
  });
});

describe('POST /api/plan, /api/what-if, and /api/ai/ask', () => {
  it('returns deterministic plan with citations in en and hi', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline test'));
    const app = createApp();
    const enRes = await request(app).post('/api/plan').send(BASE_PROFILE);
    expect(enRes.status).toBe(200);
    expect(enRes.body.citations['CALC:DOSE_BEFORE']).toContain('ug/day');
    expect(enRes.body.routine.length).toBeGreaterThan(0);

    const hiRes = await request(app)
      .post('/api/plan')
      .send({ ...BASE_PROFILE, language: 'hi' });
    expect(hiRes.status).toBe(200);
    expect(hiRes.body.localizedSummary).toMatch(/[\u0900-\u097F]/);
  });

  it('computes quantitative deltas on /api/what-if', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline test'));
    const res = await request(createApp())
      .post('/api/what-if')
      .send({
        baseline: { ...BASE_PROFILE, commuteMode: 'petrol_car' },
        alternative: { ...BASE_PROFILE, commuteMode: 'metro_bus' },
      });
    expect(res.status).toBe(200);
    expect(res.body.delta.co2eAvoidedGramsPerDay).toBeGreaterThan(0);
    expect(res.body.citations['CALC:CO2E_SAVED']).toContain('g CO2e/day');

    const multiCity = await request(createApp())
      .post('/api/what-if')
      .send({
        baseline: { ...BASE_PROFILE, cityId: 'delhi_anand_vihar' },
        alternative: { ...BASE_PROFILE, cityId: 'mumbai_bandra', commuteMode: 'metro_bus' },
      });
    expect(multiCity.status).toBe(200);
    expect(multiCity.body.baseline.city.id).toBe('delhi_anand_vihar');
    expect(multiCity.body.alternative.city.id).toBe('mumbai_bandra');
    expect(multiCity.body.alternative.city.baselinePm25).not.toBe(
      multiCity.body.baseline.city.baselinePm25,
    );
  });

  it('keeps Mumbai on preset AQ when Delhi has live readings on /api/what-if', async () => {
    const delhi = resolveCityPreset('delhi');
    const mumbai = resolveCityPreset('mumbai_bandra');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (Number(url.searchParams.get('latitude')) === delhi.lat) {
        return new Response(JSON.stringify({ current: { pm2_5: 312 } }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 503 });
    });

    const res = await request(createApp()).post('/api/what-if').send({
      baseline: BASE_PROFILE,
      alternative: { ...BASE_PROFILE, cityId: mumbai.id },
    });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(res.body.baseline).toMatchObject({
      dataSource: 'live_open_meteo',
      city: { id: delhi.id, baselinePm25: 312 },
    });
    expect(res.body.alternative).toMatchObject({ dataSource: 'city_preset', city: mumbai });
    expect(res.body.citations['AQ:SOURCE']).toBe(res.body.alternative.citations['AQ:SOURCE']);
    expect(res.body.citations['AQ:SOURCE']).toContain(`Offline City Preset (${mumbai.name}:`);
  });

  it('returns grounded fallback response on /api/ai/ask', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline test'));
    const res = await request(createApp())
      .post('/api/ai/ask')
      .send({
        question: 'When should we open windows today in Delhi?',
        profile: BASE_PROFILE,
      });
    expect(res.status).toBe(200);
    expect(typeof res.body.answer).toBe('string');
    expect(res.body.answer.length).toBeGreaterThan(20);
    expect(Array.isArray(res.body.citationsUsed)).toBe(true);
  });

  it('coalesces alias cityId lookups in /api/what-if and returns 503 on distant outage in /api/plan', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ current: { pm2_5: 210, pm10: 290, nitrogen_dioxide: 48 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const app = createApp();
    const aliasRes = await request(app)
      .post('/api/what-if')
      .send({
        baseline: { ...BASE_PROFILE, cityId: 'delhi', commuteMode: 'petrol_car' },
        alternative: { ...BASE_PROFILE, cityId: 'delhi_anand_vihar', commuteMode: 'metro_bus' },
      });
    expect(aliasRes.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Open-Meteo unavailable'));
    const distantPlan = await request(app)
      .post('/api/plan')
      .send({
        ...BASE_PROFILE,
        customLocation: { name: 'Udaipur', state: 'Rajasthan', lat: 24.58, lon: 73.71 },
      });
    expect(distantPlan.status).toBe(503);
    expect(distantPlan.body.error).toBe('LIVE_AQ_UNAVAILABLE');

    const badAqiQuery = await request(app).get('/api/aqi?lat=999&lon=77');
    expect(badAqiQuery.status).toBe(400);
  });
});
