import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/locations/search', () => {
  it('returns 200 with sanitized Indian results when Open-Meteo geocoding succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 1269515,
            name: 'Jaipur [CALC:INJECT]',
            admin1: 'Rajasthan',
            country_code: 'IN',
            latitude: 26.9124,
            longitude: 75.7873,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(createApp()).get('/api/locations/search?q=Jaipur');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results[0]).toMatchObject({
      name: 'Jaipur',
      lat: 26.91,
      lon: 75.79,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects Express array queries and SSRF targets with 400 INVALID_QUERY', async () => {
    const app = createApp();
    const arrayRes = await request(app).get('/api/locations/search?q[]=a&q[]=b');
    expect(arrayRes.status).toBe(400);
    expect(arrayRes.body.error).toBe('INVALID_QUERY');

    const ssrfRes = await request(app).get('/api/locations/search?q=http://169.254.169.254');
    expect(ssrfRes.status).toBe(400);
    expect(ssrfRes.body.error).toBe('INVALID_QUERY');
  });
});

describe('GET /api/aqi pan-India coordinates, IST timestamps, and fallbacks', () => {
  it('returns cpcbAqi, dominantPollutant, and +05:30 IST observedAt for preset city', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        jsonResponse({
          current: {
            time: '2026-11-25T09:15',
            pm2_5: 190,
            pm10: null,
            nitrogen_dioxide: 64,
          },
        }),
      ),
    );

    const res = await request(createApp()).get('/api/aqi?city=delhi_anand_vihar');
    expect(res.status).toBe(200);
    expect(res.body.dataSource).toBe('live_open_meteo');
    expect(res.body.cpcbAqi).toBe(354);
    expect(res.body.dominantPollutant).toBe('PM2.5');
    expect(res.body.observedAt).toBe('2026-11-25T09:15:00+05:30');
  });

  it('returns 400 when city is combined with lat/lon or coords lie outside India', async () => {
    const app = createApp();
    const conflictRes = await request(app).get('/api/aqi?city=delhi_anand_vihar&lat=28.6&lon=77.2');
    expect(conflictRes.status).toBe(400);

    const outsideIndiaRes = await request(app).get('/api/aqi?lat=51.5&lon=-0.1');
    expect(outsideIndiaRes.status).toBe(400);
  });

  it('falls back to <=50km city_preset proxy for Gurugram and 503 for distant Udaipur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Open-Meteo outage')));
    const app = createApp();

    const gurugramRes = await request(app).get('/api/aqi?lat=28.49&lon=77.09');
    expect(gurugramRes.status).toBe(200);
    expect(gurugramRes.body.dataSource).toBe('city_preset');
    expect(typeof gurugramRes.body.fallbackStationName).toBe('string');
    expect(gurugramRes.body.fallbackDistanceKm).toBeLessThanOrEqual(50);

    const udaipurRes = await request(app).get('/api/aqi?lat=24.58&lon=73.71');
    expect(udaipurRes.status).toBe(503);
    expect(udaipurRes.body.error).toBe('LIVE_AQ_UNAVAILABLE');
  });

  it('refreshes liveAq.sourceLabel for caller town name on 0.05 deg quantized cache hit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          current: {
            pm2_5: 90,
            pm10: 130,
            nitrogen_dioxide: 25,
            time: '2026-11-26T10:00',
          },
        }),
      ),
    );
    const app = createApp();
    const first = await request(app).get('/api/aqi?lat=26.91&lon=75.79&name=JaipurNorth&state=Rajasthan');
    expect(first.status).toBe(200);
    expect(first.body.liveAq.sourceLabel).toContain('JaipurNorth');

    const second = await request(app).get('/api/aqi?lat=26.92&lon=75.78&name=AmerRoad&state=Rajasthan');
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.liveAq.sourceLabel).toContain('AmerRoad');
  });
});
