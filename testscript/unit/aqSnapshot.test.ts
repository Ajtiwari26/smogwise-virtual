import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAirQualityForCoords, clearAirQualityCache }
  from '../../server/services/openMeteoClient.js';
import { haversineKm, resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeFullPlan } from '../../src/domain/impactService.js';
import { DEFAULT_PROFILE } from '../../src/hooks/useSmogPlan.js';

const station = resolveCityPreset('jaipur');

function coordinateAt(km: number) {
  return { name: 'Test location', lat: station.lat + km * 180 / (Math.PI * 6371), lon: station.lon };
}

afterEach(() => {
  clearAirQualityCache();
  vi.restoreAllMocks();
});

describe('AQ snapshot and unrounded distance policy', () => {
  it('keeps a 50.01997 km estimate unavailable even when displayed distance rounds to 50.0', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline fixture'));
    const customLocation = coordinateAt(50.01997);
    expect(haversineKm(station.lat, station.lon, customLocation.lat, customLocation.lon))
      .toBeCloseTo(50.01997, 4);
    const { report, routine } = computeFullPlan({ ...DEFAULT_PROFILE, customLocation });
    expect(report).toMatchObject({ aqStatus: 'unavailable', fallbackDistanceKm: 50 });
    expect(routine).toEqual([]);
    await expect(fetchAirQualityForCoords(customLocation)).rejects
      .toMatchObject({ code: 'LIVE_AQ_UNAVAILABLE' });
  });

  it.each(['nearby_proxy', 'live'])('uses the same %s key in lookup and plan', async (aqStatus) => {
    const customLocation = coordinateAt(49.99);
    const response = {
      current: { pm2_5: 64.21, pm10: 123, nitrogen_dioxide: null, time: '2026-11-28T07:00' },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      if (aqStatus === 'nearby_proxy') throw new Error('offline fixture');
      return Response.json(response);
    });
    const aq = await fetchAirQualityForCoords(customLocation);
    const { report } = computeFullPlan({ ...DEFAULT_PROFILE, customLocation }, aq.liveAq);
    expect(report.observationId).toBe(aq.observationId);
    expect(report.aqStatus).toBe(aqStatus);
  });
});
