import { clearSessionRevocations, isSessionRevoked, rememberRevocation }
  from '../../server/services/sessionRevocation.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findAccountByEmail,
  toPublicUser,
  type PublicUser,
} from '../../server/config/authAccounts.js';
import {
  clearRevokedSessionTokens,
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  buildSessionCookie,
  extractSessionToken,
  revokeSessionToken,
  signSessionToken,
  verifyCredentials,
  verifyCredentialsAsync,
  verifySessionToken,
} from '../../server/services/authService.js';
import { getEnvConfig } from '../../server/config/env.js';
import {
  getUserPreferences,
  setUserPreferences,
} from '../../server/services/preferencesStore.js';
import { CITY_PRESETS } from '../../src/domain/cityPresets.js';
import type { UserProfile } from '../../src/domain/types.js';

const TEST_AUTH_SECRET = 'unit-test-hmac-secret-key-for-smogwise-auth-2026';

const SAMPLE_USER: PublicUser = {
  id: 'eval_family',
  email: 'family.eval@smogwise.in',
  name: 'Delhi Family Evaluator',
  personaId: 'young_family',
  defaultLang: 'en',
  defaultCityId: 'delhi_anand_vihar',
};

function buildProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
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
    ...overrides,
  };
}

describe('authAccounts & verifyCredentials', () => {
  it('normalizes email casing and whitespace in findAccountByEmail', () => {
    const account = findAccountByEmail('  FAMILY.EVAL@SMOGWISE.IN  ');
    expect(account?.id).toBe('eval_family');
    if (account === undefined) {
      return;
    }
    expect(toPublicUser(account)).toEqual(SAMPLE_USER);
    expect('passwordHash' in toPublicUser(account)).toBe(false);
  });

  it('returns undefined for empty or unknown email addresses', () => {
    expect(findAccountByEmail('')).toBeUndefined();
    expect(findAccountByEmail('   ')).toBeUndefined();
    expect(findAccountByEmail('unknown@smogwise.in')).toBeUndefined();
  });

  it('authenticates valid evaluator accounts with scrypt credentials', () => {
    const familyUser = verifyCredentials('family.eval@smogwise.in', 'SmogWise#Eval2026');
    expect(familyUser?.id).toBe('eval_family');
    expect(familyUser?.personaId).toBe('young_family');

    const seniorUser = verifyCredentials('  SENIOR.EVAL@SMOGWISE.IN ', 'SmogWise#Eval2026');
    expect(seniorUser?.id).toBe('eval_senior');
    expect(seniorUser?.defaultLang).toBe('hi');
  });

  it('rejects wrong password, empty password, and unknown email with null', () => {
    expect(verifyCredentials('family.eval@smogwise.in', 'WrongPassword#2026')).toBeNull();
    expect(verifyCredentials('family.eval@smogwise.in', '')).toBeNull();
    expect(verifyCredentials('missing.user@smogwise.in', 'SmogWise#Eval2026')).toBeNull();
  });

  it('authenticates all 5 evaluator emails with valid CITY_PRESETS defaultCityId', () => {
    const presetIds = new Set(CITY_PRESETS.map((c) => c.id));
    const emails = [
      'family.eval@smogwise.in',
      'senior.eval@smogwise.in',
      'rwa.eval@smogwise.in',
      'commuter.eval@smogwise.in',
      'student.eval@smogwise.in',
    ];
    for (const email of emails) {
      const user = verifyCredentials(email, 'SmogWise#Eval2026');
      expect(user).not.toBeNull();
      expect(presetIds.has(user?.defaultCityId ?? '')).toBe(true);
      if (email === 'senior.eval@smogwise.in') {
        expect(user?.defaultCityId).toBe('lucknow_gomtinagar');
      }
    }
  });
});

describe('signSessionToken & verifySessionToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('roundtrips valid session tokens preserving all PublicUser fields', () => {
    vi.stubEnv('AUTH_SECRET', TEST_AUTH_SECRET);
    const nowMs = 1_795_000_000_000;
    const token = signSessionToken(SAMPLE_USER, nowMs);
    const verified = verifySessionToken(token, nowMs + 60_000);
    expect(verified).toEqual(SAMPLE_USER);
  });

  it('rejects tampered signatures and malformed token structures', () => {
    vi.stubEnv('AUTH_SECRET', TEST_AUTH_SECRET);
    const nowMs = 1_795_000_000_000;
    const token = signSessionToken(SAMPLE_USER, nowMs);
    const [payloadPart = '', sigPart = ''] = token.split('.');
    const flippedChar = sigPart.startsWith('a') ? 'b' : 'a';
    const tamperedSig = `${flippedChar}${sigPart.slice(1)}`;

    expect(verifySessionToken(`${payloadPart}.${tamperedSig}`, nowMs)).toBeNull();
    expect(verifySessionToken('single-part-token', nowMs)).toBeNull();
    expect(verifySessionToken(`${payloadPart}.${sigPart}.extra`, nowMs)).toBeNull();
    expect(verifySessionToken(`.${sigPart}`, nowMs)).toBeNull();
  });

  it('rejects expired session tokens beyond the 24-hour TTL', () => {
    vi.stubEnv('AUTH_SECRET', TEST_AUTH_SECRET);
    const nowMs = 1_795_000_000_000;
    const token = signSessionToken(SAMPLE_USER, nowMs);
    expect(verifySessionToken(token, nowMs + 90_000_000)).toBeNull();
  });

  it('authenticates asynchronously with verifyCredentialsAsync and honors jti revocation', async () => {
    vi.stubEnv('AUTH_SECRET', TEST_AUTH_SECRET);
    clearRevokedSessionTokens();
    const okUser = await verifyCredentialsAsync('family.eval@smogwise.in', 'SmogWise#Eval2026');
    expect(okUser).toEqual(SAMPLE_USER);
    expect(await verifyCredentialsAsync('family.eval@smogwise.in', 'Wrong#2026')).toBeNull();
    expect(await verifyCredentialsAsync('unknown@smogwise.in', 'SmogWise#Eval2026')).toBeNull();

    const nowMs = Date.now();
    const token = signSessionToken(SAMPLE_USER, nowMs);
    expect(verifySessionToken(token, nowMs + 1000)).toEqual(SAMPLE_USER);
    revokeSessionToken(token);
    expect(verifySessionToken(token, nowMs + 1000)).toBeNull();
    clearRevokedSessionTokens();

    expect(verifySessionToken(token, nowMs - 120_000)).toBeNull();
  });

  it('parses TRUST_PROXY and returns safe env config', () => {
    vi.stubEnv('TRUST_PROXY', '1');
    vi.stubEnv('PORT', '4099');
    vi.stubEnv('ALLOWED_ORIGIN', 'https://smogwise.example');
    const cfg = getEnvConfig();
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.port).toBe(4099);
    expect(cfg.allowedOrigin).toBe('https://smogwise.example');
  });
});

describe('extractSessionToken & session cookies', () => {
  it('extracts session tokens from multi-cookie headers and Bearer headers', () => {
    const multiCookie = `theme=light; ${SESSION_COOKIE_NAME}=tok_abc123; locale=en`;
    expect(extractSessionToken(multiCookie, undefined)).toBe('tok_abc123');
    expect(extractSessionToken(undefined, 'Bearer bearer_tok_789')).toBe('bearer_tok_789');
    expect(extractSessionToken(undefined, 'bearer   spaced_tok  ')).toBe('spaced_tok');
  });

  it('ignores malformed cookie strings and non-Bearer authorization headers', () => {
    expect(extractSessionToken('malformed-cookie; other=1', undefined)).toBeUndefined();
    expect(extractSessionToken(`${SESSION_COOKIE_NAME}=   `, undefined)).toBeUndefined();
    expect(extractSessionToken(undefined, 'Basic dXNlcjpwYXNz')).toBeUndefined();
    expect(extractSessionToken(undefined, 'Bearer   ')).toBeUndefined();
  });

  it('builds HttpOnly SameSite=Lax cookies with Secure conditional on isProd', () => {
    const devCookie = buildSessionCookie('signed.token', false);
    expect(devCookie).toContain(`${SESSION_COOKIE_NAME}=signed.token`);
    expect(devCookie).toContain('HttpOnly');
    expect(devCookie).toContain('SameSite=Lax');
    expect(devCookie).toContain('Path=/');
    expect(devCookie).toContain('Max-Age=86400');
    expect(devCookie).not.toContain('Secure');

    const prodCookie = buildSessionCookie('signed.token', true);
    expect(prodCookie).toContain('; Secure');

    const clearCookie = buildClearSessionCookie(true);
    expect(clearCookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(clearCookie).toContain('Max-Age=0');
    expect(clearCookie).toContain('; Secure');
  });
});

describe('preferencesStore isolation', () => {
  it('isolates stored UserProfile records per userId and ignores blank userIds', () => {
    const familyProfile = buildProfile({ cityId: 'delhi_anand_vihar', monthlyBudgetInr: 3000 });
    const seniorProfile = buildProfile({
      persona: 'sensitive_household',
      cityId: 'lucknow_gomti_nagar',
      language: 'hi',
    });

    setUserPreferences('unit_user_alpha', familyProfile);
    setUserPreferences('unit_user_beta', seniorProfile);
    setUserPreferences('   ', buildProfile({ cityId: 'kanpur_nehru_nagar' }));

    expect(getUserPreferences('unit_user_alpha')).toEqual(familyProfile);
    expect(getUserPreferences('unit_user_beta')).toEqual(seniorProfile);
    expect(getUserPreferences('unit_user_gamma')).toBeUndefined();
    expect(getUserPreferences('')).toBeUndefined();
    expect(getUserPreferences('   ')).toBeUndefined();
  });
});

it('prunes expired revocations and fails closed when all entries remain live', () => {
  clearSessionRevocations();
  try {
    for (let i = 0; i < 1000; i++) rememberRevocation(`old-${i}`, 10, 1);
    rememberRevocation('new', 100, 11);
    expect(isSessionRevoked('old-0', 1, 11)).toBe(false);
    expect(isSessionRevoked('new', 11, 11)).toBe(true);
    for (let i = 0; i < 1000; i++) rememberRevocation(`live-${i}`, 100, 12);
    expect(isSessionRevoked('live-0', 12, 12)).toBe(true);
    expect(isSessionRevoked('new', 11, 12)).toBe(true);
    expect(isSessionRevoked('future', 13, 13)).toBe(false);
  } finally {
    clearSessionRevocations();
  }
});
