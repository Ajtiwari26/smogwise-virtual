import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { compareWhatIf, computeFullPlan } from '../../src/domain/impactService.js';
import type { UserProfile } from '../../src/domain/types.js';
import {
  ApiError,
  fetchAqi,
  fetchAqiByCoords,
  fetchSession,
  fetchUserPreferences,
  loginSession,
  logoutSession,
  postAiAsk,
  postPlan,
  postPlanBriefing,
  postWhatIf,
  saveUserPreferences,
  searchLocations,
  type AqiApiResponse,
  type AuthUser,
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

const sampleAqi: AqiApiResponse = {
  city: resolveCityPreset('delhi'),
  cpcbAqi: 185,
  dataSource: 'live_open_meteo',
  aqiBand: 'moderate',
  dominantPollutant: 'PM2.5',
  fetchedAt: '2026-11-25T15:00:00Z',
  liveAq: { pm25: 85, pm10: 194 },
};

const sampleLocation = { id: 'delhi', name: 'Delhi', state: 'Delhi', lat: 28.64, lon: 77.31 };

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
    const payload = sampleAqi;
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
    const payload = { ...sampleAqi, cpcbAqi: 92, dataSource: 'city_preset' };
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
    const items = [sampleLocation];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: items }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await searchLocations('del');
    expect(res).toEqual(items);
    expect(fetchMock).toHaveBeenCalledWith('/api/locations/search?q=del', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  });

  it.each([
    null,
    { ...sampleLocation, id: '' },
    { ...sampleLocation, name: undefined },
    { ...sampleLocation, lat: '28.64' },
    { ...sampleLocation, lon: 190 },
  ])('rejects a location result with invalid fields (%j)', async (invalid) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ results: [sampleLocation, invalid] }),
    ));
    await expect(searchLocations('del')).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    { city: { ...sampleAqi.city, id: undefined } },
    { aqiBand: 'extreme' },
    { fetchedAt: 'invalid date' },
    { dataSource: 'unknown' },
    { liveAq: { pm25: 75, pm10: '80' } },
    { cached: 'yes' },
  ])('rejects an AQI response with invalid fields (%j)', async (invalid) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...sampleAqi, ...invalid })));
    await expect(fetchAqi('delhi')).rejects.toThrow('Unexpected response shape');
  });
});

describe('apiClient POST endpoints', () => {
  const altProfile: UserProfile = { ...sampleProfile, commuteDistanceKm: 5 };
  const samplePlan = computeFullPlan(sampleProfile);
  const sampleReport = samplePlan.report;
  const sampleWhatIf = compareWhatIf(sampleProfile, altProfile);
  const sampleBriefing = {
    headline: 'Act today',
    summary: 'Use low-cost filtration to cut indoor dose.',
    whyActions: ['Sealing gaps reduces particulate influx.'],
    language: 'en',
    mode: 'offline_grounded',
    citationsUsed: ['CALC:DOSE_AFTER'],
  };
  const sampleAnswer = {
    answer: 'Use N95',
    language: 'en',
    citationsUsed: ['AQ:SOURCE'],
    mode: 'offline_grounded',
    guardTriggered: false,
    report: sampleReport,
  };

  it('posts plan, plan briefing, what-if, and ai ask payloads', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(samplePlan))
      .mockResolvedValueOnce(jsonResponse(sampleBriefing))
      .mockResolvedValueOnce(jsonResponse(sampleWhatIf))
      .mockResolvedValueOnce(jsonResponse(sampleAnswer));
    vi.stubGlobal('fetch', fetchMock);

    await expect(postPlan(sampleProfile)).resolves.toEqual(samplePlan);
    await expect(postPlanBriefing(sampleProfile)).resolves.toEqual(sampleBriefing);
    await expect(postWhatIf(sampleProfile, altProfile)).resolves.toEqual(sampleWhatIf);
    await expect(postAiAsk('Mask advice?', sampleProfile)).resolves.toEqual(sampleAnswer);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects shallow plan and what-if records lacking required structure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ planId: 'p1' })));
    await expect(postPlan(sampleProfile)).rejects.toThrow('Unexpected response shape from server.');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ deltaCo2e: -12 })));
    await expect(postWhatIf(sampleProfile, sampleProfile)).rejects.toThrow(
      'Unexpected response shape from server.',
    );
  });
  it.each([
    ['briefing without a summary', { ...sampleBriefing, summary: undefined }],
    ['briefing with a bad action', { ...sampleBriefing, whyActions: [null] }],
  ])('rejects %s', async (_case, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(payload)));
    await expect(postPlanBriefing(sampleProfile)).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    ['AI answer with non-array citations', { ...sampleAnswer, citationsUsed: 'AQ:SOURCE' }],
    ['AI answer with a non-boolean guard flag', { ...sampleAnswer, guardTriggered: 'false' }],
    ['AI answer with an invalid report', { ...sampleAnswer, report: { city: {} } }],
  ])('rejects %s', async (_case, payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(payload)));
    await expect(postAiAsk('Mask advice?', sampleProfile)).rejects.toThrow(
      'Unexpected response shape',
    );
  });

  it.each([
    ['city without an id', { ...sampleReport, city: { ...sampleReport.city, id: undefined } }],
    ['exposure without a numeric baseline', {
      ...sampleReport, exposure: { ...sampleReport.exposure, baselineInhaledUgPerDay: '10' },
    }],
    ['emissions without a numeric CO2e value', {
      ...sampleReport, emissions: { ...sampleReport.emissions, co2eAvoidedGramsPerDay: null },
    }],
  ])('rejects plan and what-if reports with %s', async (_case, report) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ...samplePlan, report }))
      .mockResolvedValueOnce(jsonResponse({ ...sampleWhatIf, alternative: report })));
    await expect(postPlan(sampleProfile)).rejects.toThrow('Unexpected response shape');
    await expect(postWhatIf(sampleProfile, altProfile)).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    ['a null routine item', { routine: [null] }],
    ['a malformed routine item', { routine: [{ id: 'sleep' }] }],
    ['a null IAQ hack', { iaqHacks: [null] }],
    ['a malformed IAQ hack', { iaqHacks: [{ id: 'wet_mopping' }] }],
  ])('rejects plans with %s', async (_case, fields) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ ...samplePlan, ...fields })));
    await expect(postPlan(sampleProfile)).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    ['non-numeric CO2e delta', { delta: { ...sampleWhatIf.delta, co2eAvoidedGramsPerDay: '5' } }],
    ['missing Hindi explanation', { explanation: { en: 'English only' } }],
    ['non-string English explanation', { explanation: { en: null, hi: 'टेस्ट' } }],
  ])('rejects what-if responses with %s', async (_case, fields) => {
    const payload = { ...sampleWhatIf, ...fields };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(payload)));
    await expect(postWhatIf(sampleProfile, altProfile)).rejects.toThrow('Unexpected response shape');
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

describe('apiClient auth and user preference endpoints', () => {
  const sampleUser: AuthUser = {
    id: 'usr-1',
    email: 'family.eval@smogwise.in',
    name: 'Delhi Family',
    personaId: 'young_family',
    defaultLang: 'en',
    defaultCityId: 'delhi_anand_vihar',
  };

  it('sends credentials: same-origin across auth and preference endpoints', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ user: sampleUser }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, user: sampleUser }))
      .mockResolvedValueOnce(jsonResponse({ profile: sampleProfile }))
      .mockResolvedValueOnce(jsonResponse({ profile: sampleProfile }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginSession(sampleUser.email, 'SmogWise#Eval2026')).resolves.toEqual({
      user: sampleUser,
    });
    await expect(fetchSession()).resolves.toEqual({ authenticated: true, user: sampleUser });
    await expect(fetchUserPreferences()).resolves.toEqual({ profile: sampleProfile });
    await expect(saveUserPreferences(sampleProfile, undefined, '"v0"')).resolves.toEqual({
      profile: sampleProfile,
    });
    await expect(logoutSession()).resolves.toEqual({ ok: true });

    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: 'same-origin' });
    }
  });

  it('resolves unauthenticated session cleanly on 200 without throwing', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, user: null }, 200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchSession()).resolves.toEqual({ authenticated: false, user: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { ...sampleUser, email: 42 },
    { ...sampleUser, email: 'invalid email' },
    { ...sampleUser, defaultLang: 'fr' },
  ])('rejects malformed user objects on login and session (%j)', async (user) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ user }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, user })));
    await expect(loginSession(sampleUser.email, 'example')).rejects.toThrow(
      'Unexpected response shape',
    );
    await expect(fetchSession()).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    { authenticated: true, user: null },
    { authenticated: false, user: sampleUser },
  ])('rejects a session with inconsistent auth state (%j)', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(payload)));
    await expect(fetchSession()).rejects.toThrow('Unexpected response shape');
  });

  it.each([
    {},
    { ...sampleProfile, roomVolumeM3: '45' },
    { ...sampleProfile, activeHacks: ['unknown'] },
    { ...sampleProfile, rwaAdoptionRate: '45%' },
    { ...sampleProfile, customLocation: { name: 'Delhi', lat: 28.64 } },
  ])('rejects malformed profile objects on both preference endpoints (%j)', async (profile) => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ profile }))
      .mockResolvedValueOnce(jsonResponse({ profile })));
    await expect(fetchUserPreferences()).rejects.toThrow('Unexpected response shape');
    await expect(saveUserPreferences(sampleProfile, undefined, '"v0"'))
      .rejects.toThrow('Unexpected response shape');
  });

  it('accepts null preferences on GET and requires the saved profile on PUT', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ profile: null }))
      .mockResolvedValueOnce(jsonResponse({ profile: null })));
    await expect(fetchUserPreferences()).resolves.toEqual({ profile: null });
    await expect(saveUserPreferences(sampleProfile, undefined, '"v0"'))
      .rejects.toThrow('Unexpected response shape');
    await expect(saveUserPreferences(sampleProfile, undefined, ''))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_IF_MATCH' });
  });

  it('throws ApiError with status 401 on failed loginSession', async () => {
    const errPayload = { error: 'INVALID_CREDENTIALS', message: 'Invalid credentials' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(errPayload, 401)));

    await expect(loginSession('bad@smogwise.in', 'wrong')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects non-object and invalid-shape JSON server responses with ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse(['unexpected_array'], 200)));
    await expect(fetchAqi('delhi')).rejects.toThrow('Unexpected non-object response from server.');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ unexpected: true }, 200)));
    await expect(fetchAqi('delhi')).rejects.toThrow('Unexpected response shape from server.');
  });

  it('forwards non-empty state parameter in fetchAqiByCoords query string', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ ...sampleAqi, cpcbAqi: 105, dataSource: 'city_preset' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await fetchAqiByCoords(23.2599, 77.4126, 'Bhopal', 'Madhya Pradesh');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('state=Madhya+Pradesh');
  });
});

it('rejects malformed successful responses using ApiError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Not JSON</html>')));
  await expect(fetchSession()).rejects.toMatchObject({
    name: 'ApiError', code: 'INVALID_JSON', status: 200,
  });
});

it.each([{ householdSize: 2.5 }, { rwaHouseholds: 99.5 }])(
  'rejects a fractional integer field in preferences %j',
  async (patch) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      profile: { ...sampleProfile, ...patch },
    })));
    await expect(fetchUserPreferences()).rejects.toBeInstanceOf(ApiError);
  },
);
