import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../server/app.js';
import type { UserProfile } from '../../src/domain/types.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const VALID_PASSWORD = 'SmogWise#Eval2026';
const TAMPERED_COOKIE = 'smogwise_session=eyJzdWIiOiJldmFsX2ZhbWlseSJ9.invalidsig';

const SAMPLE_PROFILE: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: true,
  monthlyBudgetInr: 2500,
  roomVolumeM3: 45,
  commuteMode: 'metro_bus',
  commuteDistanceKm: 12,
  cookingFuel: 'lpg',
  activeHacks: ['window_sealing', 'wet_mopping'],
};

function extractCookiePair(setCookieHeader: string[] | string | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  if (raw === undefined) {
    throw new Error('Expected Set-Cookie header to be present');
  }
  const firstSegment = raw.split(';')[0];
  if (firstSegment === undefined || firstSegment.trim().length === 0) {
    throw new Error('Expected non-empty cookie pair in Set-Cookie');
  }
  return firstSegment.trim();
}

describe('Protected preferences access & public session/logout behavior', () => {
  it('returns 401 and no-store when unauthenticated on /api/user/preferences', async () => {
    const app = createApp();
    const getRes = await request(app).get('/api/user/preferences');
    expect(getRes.status).toBe(401);
    expect(getRes.headers['cache-control']).toBe('private, no-store');

    const putRes = await request(app).put('/api/user/preferences').send({ profile: SAMPLE_PROFILE });
    expect(putRes.status).toBe(401);
    expect(putRes.headers['cache-control']).toBe('private, no-store');
  });

  it('rejects bearer tokens and tampered cookie with 401 on /api/user/preferences', async () => {
    const app = createApp();
    const demoRes = await request(app)
      .get('/api/user/preferences')
      .set('Authorization', 'Bearer demo-token');
    expect(demoRes.status).toBe(401);
    expect(demoRes.headers['cache-control']).toBe('private, no-store');

    const offlineRes = await request(app)
      .get('/api/user/preferences')
      .set('Authorization', 'Bearer offline-demo-token');
    expect(offlineRes.status).toBe(401);
    expect(offlineRes.headers['cache-control']).toBe('private, no-store');

    const tamperedRes = await request(app)
      .get('/api/user/preferences')
      .set('Cookie', TAMPERED_COOKIE);
    expect(tamperedRes.status).toBe(401);
    expect(tamperedRes.headers['cache-control']).toBe('private, no-store');
  });

  it('returns 200 and { authenticated: false, user: null } on unauthenticated session', async () => {
    const app = createApp();
    const anonRes = await request(app).get('/api/auth/session');
    expect(anonRes.status).toBe(200);
    expect(anonRes.headers['cache-control']).toBe('private, no-store');
    expect(anonRes.body).toEqual({ authenticated: false, user: null });

    const bearerRes = await request(app)
      .get('/api/auth/session')
      .set('Authorization', 'Bearer demo-token');
    expect(bearerRes.status).toBe(200);
    expect(bearerRes.headers['cache-control']).toBe('private, no-store');
    expect(bearerRes.body).toEqual({ authenticated: false, user: null });

    const tamperedRes = await request(app).get('/api/auth/session').set('Cookie', TAMPERED_COOKIE);
    expect(tamperedRes.status).toBe(200);
    expect(tamperedRes.headers['cache-control']).toBe('private, no-store');
    expect(tamperedRes.body).toEqual({ authenticated: false, user: null });
  });

  it('returns 200, { ok: true }, and Max-Age=0 on unauthenticated POST /api/auth/logout', async () => {
    const app = createApp();
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({ ok: true });
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('POST /api/auth/login validation & session issuance', () => {
  it('returns 400 on invalid LoginSchema and 401 on wrong password', async () => {
    const app = createApp();
    const invalidEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'not-an-email', password: VALID_PASSWORD });
    expect(invalidEmail.status).toBe(400);

    const shortPass = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: 'short' });
    expect(shortPass.status).toBe(400);

    const wrongPass = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: 'WrongPassword#2026' });
    expect(wrongPass.status).toBe(401);
    expect(wrongPass.body).toMatchObject({ error: 'INVALID_CREDENTIALS' });
  });

  it('issues HttpOnly SameSite=Lax cookie and no-store header on valid login', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: VALID_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toMatchObject({
      user: { id: 'eval_family', email: 'family.eval@smogwise.in' },
    });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('smogwise_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
  });
});

describe('Authenticated session, user preference isolation & logout', () => {
  it('persists preferences per authenticated user and isolates across accounts', async () => {
    const app = createApp();
    const loginOne = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: VALID_PASSWORD });
    const cookieOne = extractCookiePair(loginOne.headers['set-cookie']);

    const sessionRes = await request(app).get('/api/auth/session').set('Cookie', cookieOne);
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.body).toMatchObject({ authenticated: true, user: { id: 'eval_family' } });

    const badPut = await request(app)
      .put('/api/user/preferences')
      .set('Cookie', cookieOne)
      .send({ profile: { invalid: true } });
    expect(badPut.status).toBe(400);

    const putRes = await request(app)
      .put('/api/user/preferences')
      .set('Cookie', cookieOne)
      .send({ profile: SAMPLE_PROFILE });
    expect(putRes.status).toBe(200);

    const getOne = await request(app).get('/api/user/preferences').set('Cookie', cookieOne);
    expect(getOne.status).toBe(200);
    expect(getOne.body).toEqual({ profile: SAMPLE_PROFILE });

    const loginTwo = await request(app)
      .post('/api/auth/login')
      .send({ email: 'commuter.eval@smogwise.in', password: VALID_PASSWORD });
    const cookieTwo = extractCookiePair(loginTwo.headers['set-cookie']);
    const getTwo = await request(app).get('/api/user/preferences').set('Cookie', cookieTwo);
    expect(getTwo.status).toBe(200);
    expect(getTwo.body).toEqual({ profile: null });
  });

  it('clears the session cookie on POST /api/auth/logout with Max-Age=0', async () => {
    const app = createApp();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'senior.eval@smogwise.in', password: VALID_PASSWORD });
    const cookie = extractCookiePair(loginRes.headers['set-cookie']);

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers['cache-control']).toBe('private, no-store');
    expect(logoutRes.body).toEqual({ ok: true });
    expect(String(logoutRes.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('Brute-force rate limiting & public evaluator routes', () => {
  it('enforces HTTP 429 on the 21st login attempt via authLimiter', async () => {
    const app = createApp();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'family.eval@smogwise.in', password: 'WrongPassword#2026' });
      expect(res.status).toBe(401);
    }
    const blockedRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: VALID_PASSWORD });
    expect(blockedRes.status).toBe(429);
  });

  it('keeps GET /api/health and POST /api/plan accessible without auth headers', async () => {
    const app = createApp();
    const healthRes = await request(app).get('/api/health');
    expect(healthRes.status).toBe(200);

    const planRes = await request(app)
      .post('/api/plan')
      .send({ profile: SAMPLE_PROFILE, useLiveAq: false });
    expect(planRes.status).toBe(200);
  });

  it('attaches sessionLimiter headers to session and preferences routes and rejects roomVolumeM3 < 12', async () => {
    const app = createApp();
    const sessionRes = await request(app).get('/api/auth/session');
    expect(sessionRes.status).toBe(200);
    expect(sessionRes.headers['ratelimit-policy']).toBe('120;w=900');

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'family.eval@smogwise.in', password: VALID_PASSWORD });
    const cookie = extractCookiePair(loginRes.headers['set-cookie']);

    const getPrefs = await request(app).get('/api/user/preferences').set('Cookie', cookie);
    expect(getPrefs.status).toBe(200);
    expect(getPrefs.headers['ratelimit-policy']).toBe('120;w=900');

    const invalidRoom = await request(app)
      .put('/api/user/preferences')
      .set('Cookie', cookie)
      .send({ profile: { ...SAMPLE_PROFILE, roomVolumeM3: 10 } });
    expect(invalidRoom.status).toBe(400);
    expect(invalidRoom.headers['ratelimit-policy']).toBe('120;w=900');
  });

  it('decouples POST /api/auth/logout from authLimiter and revokes session jti immediately', async () => {
    const app = createApp();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'senior.eval@smogwise.in', password: VALID_PASSWORD });
    const cookie = extractCookiePair(loginRes.headers['set-cookie']);

    for (let i = 0; i < 20; i += 1) {
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'senior.eval@smogwise.in', password: 'WrongPassword#2026' });
    }
    const rateLimitedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'senior.eval@smogwise.in', password: VALID_PASSWORD });
    expect(rateLimitedLogin.status).toBe(429);

    const logoutRes = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers['ratelimit-policy']).toBe('120;w=900');

    const replayPrefs = await request(app).get('/api/user/preferences').set('Cookie', cookie);
    expect(replayPrefs.status).toBe(401);
  });

  it('honors useLiveAq: false on /api/plan and /api/plan/briefing while rejecting it on preferences', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const app = createApp();

    const planRes = await request(app)
      .post('/api/plan')
      .send({ profile: SAMPLE_PROFILE, useLiveAq: false });
    expect(planRes.status).toBe(200);
    expect(planRes.body.report.dataSource).toBe('city_preset');
    expect(fetchSpy).not.toHaveBeenCalled();

    const briefingRes = await request(app)
      .post('/api/plan/briefing')
      .send({ profile: SAMPLE_PROFILE, useLiveAq: false });
    expect(briefingRes.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'commuter.eval@smogwise.in', password: VALID_PASSWORD });
    const cookie = extractCookiePair(loginRes.headers['set-cookie']);

    const badPrefsEnvelope = await request(app)
      .put('/api/user/preferences')
      .set('Cookie', cookie)
      .send({ profile: SAMPLE_PROFILE, useLiveAq: false });
    expect(badPrefsEnvelope.status).toBe(400);

    const conflictPrefsEnvelope = await request(app)
      .put('/api/user/preferences')
      .set('Cookie', cookie)
      .send({ city: 'delhi', profile: SAMPLE_PROFILE });
    expect(conflictPrefsEnvelope.status).toBe(400);
  });
});
