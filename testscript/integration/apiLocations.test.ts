import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import {
  clearGeocodingCache,
  searchIndianLocations,
} from '../../server/services/geocodingClient.js';
import { fetchBoundedJson } from '../../server/services/httpFetch.js';
import {
  findNearestIndianPreset,
  haversineKm,
  normalizeObservedAt,
} from '../../server/services/openMeteoHelpers.js';
import {
  clearAirQualityCache,
  fetchAirQualityForCoords,
  LiveAqUnavailableError,
} from '../../server/services/openMeteoClient.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  clearAirQualityCache();
  clearGeocodingCache();
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
          {
            id: 9999991,
            name: 'BorderMissingCountry',
            admin1: 'Unknown',
            latitude: 30.1,
            longitude: 72.1,
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(createApp()).get('/api/locations/search?q=Jaipur');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.some((r: { name: string }) => r.name === 'BorderMissingCountry')).toBe(
      false,
    );
    expect(res.body.results[0]).toMatchObject({
      name: 'Jaipur',
      lat: 26.91,
      lon: 75.79,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { results: null }, { error: true, generationtime_ms: 0.4 }, null])(
    'uses matching presets and retries after malformed geocoding payload %j',
    async (invalidPayload) => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(invalidPayload))
        .mockResolvedValueOnce(jsonResponse({
          results: [{
            name: 'Bandra', admin1: 'Maharashtra', country_code: 'in',
            latitude: 19.06, longitude: 72.83,
          }],
        }));
      vi.stubGlobal('fetch', fetchMock);

      expect(await searchIndianLocations('Bandra')).toMatchObject([{ id: 'mumbai_bandra' }]);
      expect(await searchIndianLocations('Bandra')).toMatchObject([{ name: 'Bandra' }]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([{ results: [] }, { generationtime_ms: 0.4 }])(
    'caches valid empty payload %j while continuing to surface matching presets',
    async (emptyPayload) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(emptyPayload));
      vi.stubGlobal('fetch', fetchMock);

      const results = await searchIndianLocations('Bandra');
      expect(results).toMatchObject([{ id: 'mumbai_bandra' }]);
      expect(await searchIndianLocations('Bandra')).toEqual(results);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects Express array queries and SSRF targets with 400 INVALID_QUERY', async () => {
    const app = createApp();
    const arrayRes = await request(app).get('/api/locations/search?q[]=a&q[]=b');
    expect(arrayRes.status).toBe(400);
    expect(arrayRes.body.error).toBe('INVALID_QUERY');

    const ssrfRes = await request(app).get('/api/locations/search?q=http://169.254.169.254');
    expect(ssrfRes.status).toBe(400);
    expect(ssrfRes.body.error).toBe('INVALID_QUERY');
  });

  it('supports Hindi Devanagari searches and marks degraded when upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Open-Meteo down')));
    const app = createApp();
    const hiRes = await request(app).get(`/api/locations/search?q=${encodeURIComponent('दिल्ली')}`);
    expect(hiRes.status).toBe(200);
    expect(hiRes.body.degraded).toBe(true);
    expect(hiRes.body.results.some((r: { id: string }) => r.id === 'delhi_anand_vihar')).toBe(true);
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

  it.each([false, true])('isolates near/far fallback in one grid (far starts first: %s)', async (
    farFirst,
  ) => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Open-Meteo outage'));
    vi.stubGlobal('fetch', fetchMock);
    const near = { lat: 18.6111, lon: 72.8295, name: 'Near' };
    const far = { lat: 18.60895, lon: 72.8295, name: 'Far' };
    expect(findNearestIndianPreset(near.lat, near.lon).distanceKm).toBeCloseTo(49.87, 2);
    expect(findNearestIndianPreset(far.lat, far.lon).distanceKm).toBeCloseTo(50.11, 2);

    const [first, second] = farFirst
      ? [fetchAirQualityForCoords(far), fetchAirQualityForCoords(near)]
      : [fetchAirQualityForCoords(near), fetchAirQualityForCoords(far)];
    const [nearResult, farResult] = farFirst ? [second, first] : [first, second];
    await Promise.all([
      expect(nearResult).resolves.toMatchObject({
        city: { name: 'Near' }, dataSource: 'city_preset', fallbackDistanceKm: 49.9,
      }),
      expect(farResult).rejects.toBeInstanceOf(LiveAqUnavailableError),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('rejects non-JSON Content-Type & >256KB streamed bodies in fetchBoundedJson and isolates concurrent singleflight labels', async () => {
    clearAirQualityCache();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response('<html>bad</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(new Uint8Array(1024), {
            status: 200,
            headers: { 'content-type': 'application/json', 'content-length': '9999999' },
          }),
        ),
    );
    expect(await fetchBoundedJson('https://example.test/html', 1000)).toBeNull();
    expect(await fetchBoundedJson('https://example.test/huge', 1000, 512)).toBeNull();

    const oversizedStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600));
        controller.close();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(oversizedStream, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    expect(await fetchBoundedJson('https://example.test/stream-big', 1000, 500)).toBeNull();

    expect(Number.isFinite(haversineKm(0, 0, 0, 180))).toBe(true);
    expect(normalizeObservedAt('2026-11-25T09:15:30')).toBe('2026-11-25T09:15:30+05:30');
    expect(normalizeObservedAt('   ')).toBeUndefined();
    expect(normalizeObservedAt('2026-11-25T09:15:30Z')).toBe('2026-11-25T09:15:30Z');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          current: { pm2_5: 145, pm10: 190, nitrogen_dioxide: 30, time: '2026-11-26T14:00' },
        }),
      ),
    );
    const app = createApp();
    const [r1, r2] = await Promise.all([
      request(app).get('/api/aqi?lat=26.91&lon=75.79&name=TownAlpha&state=Rajasthan'),
      request(app).get('/api/aqi?lat=26.91&lon=75.79&name=TownBeta&state=Rajasthan'),
    ]);
    expect(r1.body.city.name).toBe('TownAlpha');
    expect(r2.body.city.name).toBe('TownBeta');
  });
});
