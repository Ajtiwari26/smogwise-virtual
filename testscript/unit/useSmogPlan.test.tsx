// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveReportAq } from '../../src/domain/liveAqResolver.js';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import type {
  LiveAqOverride,
  LocationSearchItem,
  UserProfile,
} from '../../src/domain/types.js';
import { DEFAULT_PROFILE, useSmogPlan } from '../../src/hooks/useSmogPlan.js';
import {
  BRIEFING_DEBOUNCE_MS,
  DEBOUNCE_MS,
} from '../../src/hooks/useSmogPlanHelpers.js';
import * as apiClient from '../../src/services/apiClient.js';
import type {
  AqiApiResponse,
  PlanBriefingApiResponse,
} from '../../src/services/apiClient.js';

vi.mock('../../src/services/apiClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/apiClient.js')>(
    '../../src/services/apiClient.js',
  );
  return {
    ...actual,
    fetchAqi: vi.fn(),
    fetchAqiByCoords: vi.fn(),
    postPlan: vi.fn(),
    postPlanBriefing: vi.fn(),
  };
});

const mockedFetchAqi = vi.mocked(apiClient.fetchAqi);
const mockedFetchAqiByCoords = vi.mocked(apiClient.fetchAqiByCoords);
const mockedPostPlan = vi.mocked(apiClient.postPlan);
const mockedPostPlanBriefing = vi.mocked(apiClient.postPlanBriefing);

const mockLiveAq: LiveAqOverride = {
  pm25: 185,
  pm10: 310,
  cpcbAqi: 351,
  dominantPollutant: 'PM2.5',
  sourceLabel: 'live_open_meteo',
  observedAt: '2026-11-25T15:00:00Z',
};

const mockAqiResponse: AqiApiResponse = {
  city: resolveCityPreset('delhi_anand_vihar'),
  dataSource: 'live_open_meteo',
  cpcbAqi: 351,
  aqiBand: 'very_poor',
  dominantPollutant: 'PM2.5',
  fetchedAt: '2026-11-25T15:00:00Z',
  observedAt: '2026-11-25T15:00:00Z',
  liveAq: mockLiveAq,
};

const mockBriefingResponse: PlanBriefingApiResponse = {
  headline: 'High PM2.5 advisory for Anand Vihar',
  summary: 'Keep windows sealed and run HEPA filtration during peak traffic hours.',
  whyActions: ['Sealing windows lowers PM2.5 infiltration.'],
  language: 'en',
  mode: 'gemini_interactions',
  citationsUsed: ['CALC:DOSE_AFTER'],
  observationId: resolveReportAq(DEFAULT_PROFILE, mockLiveAq).observationId,
  aqStatus: 'live',
};

function setupDefaultMocks(): void {
  document.documentElement.lang = 'en';
  mockedFetchAqi.mockResolvedValue(mockAqiResponse);
  mockedFetchAqiByCoords.mockResolvedValue(mockAqiResponse);
  mockedPostPlan.mockImplementation(async (profile) => {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    return computeFullPlan(profile, mockLiveAq);
  });
  mockedPostPlanBriefing.mockResolvedValue(mockBriefingResponse);
}

function cleanupTestState(): void {
  vi.clearAllMocks();
  vi.useRealTimers();
  document.documentElement.lang = 'en';
}

describe('useSmogPlan profile and language', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

  it('updates profile fields via updateProfile', () => {
    const { result } = renderHook(() => useSmogPlan());

    act(() => {
      result.current.updateProfile({
        householdSize: 6,
        monthlyBudgetInr: 4000,
        commuteMode: 'metro_bus',
      });
    });

    expect(result.current.profile.householdSize).toBe(6);
    expect(result.current.profile.monthlyBudgetInr).toBe(4000);
    expect(result.current.profile.commuteMode).toBe('metro_bus');
  });

  it('adds and removes IAQ hacks via toggleHack', () => {
    const { result } = renderHook(() => useSmogPlan());
    expect(result.current.profile.activeHacks).toContain('window_sealing');

    act(() => {
      result.current.toggleHack('window_sealing');
    });
    expect(result.current.profile.activeHacks).not.toContain('window_sealing');

    act(() => {
      result.current.toggleHack('window_sealing');
    });
    expect(result.current.profile.activeHacks).toContain('window_sealing');
  });

  it('updates profile language and syncs <html lang> when setLanguage is called', async () => {
    const { result } = renderHook(() => useSmogPlan());
    expect(document.documentElement.lang).toBe('en');

    act(() => {
      result.current.setLanguage('hi');
    });

    expect(result.current.profile.language).toBe('hi');
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('hi');
    });
  });
});

describe('useSmogPlan scenario application', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

  it('replaces the entire profile and clears stale remote state on applySampleScenario', () => {
    const { result } = renderHook(() => useSmogPlan());

    const scenario: UserProfile = {
      ...DEFAULT_PROFILE,
      persona: 'sensitive_household',
      cityId: 'lucknow_gomti_nagar',
      language: 'hi',
      householdSize: 2,
      monthlyBudgetInr: 1800,
      rwaHouseholds: 80,
      rwaAdoptionRate: 0.6,
    };

    act(() => {
      result.current.applySampleScenario(scenario);
    });

    expect(result.current.profile).toEqual(scenario);
    expect(result.current.liveAq).toBeUndefined();
    expect(result.current.aqMeta).toBeUndefined();
    expect(result.current.aqiError).toBeUndefined();
    expect(result.current.briefing).toBeUndefined();
  });
});

describe('useSmogPlan location selection and preset switching', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

  it('sets customLocation and triggers postPlan without redundant fetchAqiByCoords', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSmogPlan());

    const location: LocationSearchItem = {
      id: 'loc-bhopal',
      name: 'Arera Colony',
      state: 'Madhya Pradesh',
      lat: 23.2156,
      lon: 77.4305,
    };

    act(() => {
      result.current.selectLocation(location);
    });

    expect(result.current.profile.customLocation).toEqual({
      name: 'Arera Colony',
      state: 'Madhya Pradesh',
      lat: 23.2156,
      lon: 77.4305,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(mockedPostPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        customLocation: {
          name: 'Arera Colony',
          state: 'Madhya Pradesh',
          lat: 23.2156,
          lon: 77.4305,
        },
      }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(mockedFetchAqiByCoords).not.toHaveBeenCalled();
  });

  it('clears customLocation and updates cityId on selectPresetCity', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSmogPlan());

    act(() => {
      result.current.selectLocation({
        id: 'loc-1',
        name: 'Indiranagar',
        state: 'Karnataka',
        lat: 12.9784,
        lon: 77.6408,
      });
    });
    expect(result.current.profile.customLocation).toEqual({
      name: 'Indiranagar',
      state: 'Karnataka',
      lat: 12.9784,
      lon: 77.6408,
    });

    act(() => {
      result.current.selectPresetCity('mumbai_bandra');
    });

    expect(result.current.profile.cityId).toBe('mumbai_bandra');
    expect(result.current.profile.customLocation).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(mockedPostPlan).toHaveBeenCalledWith(
      expect.objectContaining({ cityId: 'mumbai_bandra' }),
      expect.any(AbortSignal),
      undefined,
    );
    expect(mockedFetchAqi).not.toHaveBeenCalled();
  });
});

describe('useSmogPlan RWA and briefing hydration', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

  it('updates RWA households and adoption rate via dedicated actions', () => {
    const { result } = renderHook(() => useSmogPlan());

    act(() => {
      result.current.updateRwaHouseholds(250);
      result.current.updateRwaAdoptionRate(0.75);
    });

    expect(result.current.profile.rwaHouseholds).toBe(250);
    expect(result.current.profile.rwaAdoptionRate).toBe(0.75);
  });

  it('hydrates briefing after BRIEFING_DEBOUNCE_MS and clears loading flag', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSmogPlan());

    expect(result.current.isBriefingLoading).toBe(true);
    expect(result.current.briefing).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });

    expect(mockedPostPlanBriefing).toHaveBeenCalledTimes(1);
    expect(result.current.isBriefingLoading).toBe(false);
    expect(result.current.briefing).toEqual(mockBriefingResponse);
  });

  it('preserves hydrated briefing when RWA controls update', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSmogPlan());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });
    expect(result.current.briefing).toEqual(mockBriefingResponse);
    const initialRequest = mockedPostPlanBriefing.mock.calls.at(-1)?.[0];
    expect(initialRequest).toMatchObject({ cityId: DEFAULT_PROFILE.cityId });
    expect(initialRequest).not.toHaveProperty('rwaHouseholds');
    expect(initialRequest).not.toHaveProperty('rwaAdoptionRate');

    act(() => {
      result.current.updateRwaHouseholds(250);
      result.current.updateRwaAdoptionRate(0.75);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });
    expect(mockedPostPlanBriefing).toHaveBeenCalledTimes(1);
    expect(result.current.briefing).toEqual(mockBriefingResponse);
  });
});

describe('useSmogPlan error states', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

  it('attributes the local plan to the nearest preset after distant custom AQ returns 503', async () => {
    vi.useFakeTimers();
    const unavailable = new apiClient.ApiError('Unavailable', 503, 'LIVE_AQ_UNAVAILABLE');
    mockedFetchAqiByCoords.mockRejectedValue(unavailable);
    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    expect(result.current.liveAq).toEqual(mockLiveAq);
    mockedPostPlan.mockRejectedValue(unavailable);
    act(() => result.current.updateProfile({
      customLocation: { name: 'Udaipur', state: 'Rajasthan', lat: 24.5854, lon: 73.7125 },
    }));
    expect(result.current.liveAq).toBeUndefined();
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });

    const jaipur = resolveCityPreset('jaipur');
    const { report } = result.current.plan;
    expect(result.current.aqiError).toContain('temporarily unavailable');
    expect(result.current.aqMeta).toBeUndefined();
    expect(report.city.name).toBe('Udaipur, Rajasthan');
    expect(report.city.baselinePm25).toBe(jaipur.baselinePm25);
    expect(report.fallbackStationName).toBe(jaipur.name);
    expect(report.aqStatus).toBe('unavailable');
    expect(report.citations['AQ:SOURCE']).toContain('Live AQ unavailable');
    expect(report.citations['AQ:SOURCE']).toContain(jaipur.name);
  });

  it('surfaces localized 503 LIVE_AQ_UNAVAILABLE error banner in both en and hi', async () => {
    vi.useFakeTimers();
    const unavailableErr = new apiClient.ApiError(
      'Service unavailable',
      503,
      'LIVE_AQ_UNAVAILABLE',
    );
    mockedFetchAqi.mockRejectedValue(unavailableErr);
    mockedPostPlan.mockRejectedValue(unavailableErr);

    const { result } = renderHook(() => useSmogPlan());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(result.current.aqiError).toBe(
      'Live air quality data is temporarily unavailable for this location. Select a major city preset or retry.',
    );

    act(() => {
      result.current.setLanguage('hi');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(result.current.aqiError).toBe(
      'इस स्थान के लिए लाइव वायु गुणवत्ता डेटा अस्थायी रूप से उपलब्ध नहीं है। प्रमुख शहर चुनें या पुनः प्रयास करें।',
    );
  });

  it('re-localizes active AQI error immediately when toggling language without re-fetching and keeps isSyncing scoped to AQ', async () => {
    vi.useFakeTimers();
    const unavailableErr = new apiClient.ApiError(
      'Service unavailable',
      503,
      'LIVE_AQ_UNAVAILABLE',
    );
    mockedFetchAqi.mockRejectedValue(unavailableErr);
    mockedPostPlan.mockRejectedValue(unavailableErr);

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(result.current.aqiError).toContain('temporarily unavailable');
    expect(result.current.isSyncing).toBe(false);

    // Switching language should immediately re-localize the error banner from aqiErrorCode
    act(() => {
      result.current.setLanguage('hi');
    });
    expect(result.current.aqiError).toContain('अस्थायी रूप से उपलब्ध नहीं है');

    // Updating RWA sliders must not set isSyncing to true
    act(() => {
      result.current.updateRwaHouseholds(220);
    });
    expect(result.current.isSyncing).toBe(false);
  });

  it('scales community emissions and rwaNotice on RWA slider edits without firing /api/plan or /api/plan/briefing', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSmogPlan());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(DEBOUNCE_MS, BRIEFING_DEBOUNCE_MS) + 20);
    });

    const planCallsBefore = mockedPostPlan.mock.calls.length;
    const briefingCallsBefore = mockedPostPlanBriefing.mock.calls.length;
    const initialCo2e = result.current.plan.report.emissions.communityCo2eAvoidedKgPerMonth;

    act(() => {
      result.current.updateRwaHouseholds(600);
      result.current.updateRwaAdoptionRate(0.75);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS + 50);
    });

    expect(mockedPostPlan.mock.calls.length).toBe(planCallsBefore);
    expect(mockedPostPlanBriefing.mock.calls.length).toBe(briefingCallsBefore);
    expect(result.current.plan.report.emissions.communityCo2eAvoidedKgPerMonth).toBeGreaterThan(
      initialCo2e,
    );
    expect(result.current.plan.rwaNotice).toContain('600');
    expect(result.current.plan.rwaNotice).toContain('75%');
  });
});

it('rejects a briefing from a different observation even for the same profile', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    mockedPostPlanBriefing.mockResolvedValue({ ...mockBriefingResponse, observationId: 'stale' });
    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(result.current.briefing).toBeUndefined();
    expect(result.current.briefingFailed).toBe(true);
    expect(result.current.plan.report.observationId).toBe(mockBriefingResponse.observationId);
  } finally {
    cleanupTestState();
  }
});

it('carries authoritative snapshotToken from /api/plan into /api/plan/briefing and liveAq', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const fresherLiveAq: LiveAqOverride = {
      ...mockLiveAq, pm25: 250, observedAt: '2026-11-25T16:00:00Z',
    };
    const fresherId = resolveReportAq(DEFAULT_PROFILE, fresherLiveAq).observationId;
    mockedPostPlan.mockImplementation(async (profile) => {
      const { computeFullPlan } = await import('../../src/domain/impactService.js');
      return { ...computeFullPlan(profile, fresherLiveAq), snapshotToken: 'signed-snap-token' };
    });
    mockedPostPlanBriefing.mockResolvedValue({ ...mockBriefingResponse, observationId: fresherId });

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.max(DEBOUNCE_MS, BRIEFING_DEBOUNCE_MS) + 20);
    });

    expect(result.current.plan.report.observationId).toBe(fresherId);
    expect(result.current.liveAq?.pm25).toBe(250);
    expect(result.current.snapshotToken).toBe('signed-snap-token');
    expect(mockedPostPlanBriefing).toHaveBeenCalledWith(
      expect.objectContaining({ cityId: DEFAULT_PROFILE.cityId }),
      expect.any(AbortSignal),
      'signed-snap-token',
    );
    expect(result.current.briefing?.observationId).toBe(fresherId);
    expect(result.current.briefingFailed).toBe(false);
  } finally {
    cleanupTestState();
  }
});

it('preserves settled live AQ on transient non-503 plan failure after budget edit', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { result } = renderHook(() => useSmogPlan());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });
    expect(result.current.liveAq?.pm25).toBe(185);
    expect(result.current.plan.report.city.baselinePm25).toBe(185);

    mockedPostPlan.mockRejectedValueOnce(new Error('network blip'));
    act(() => {
      result.current.updateProfile({ monthlyBudgetInr: 4000 });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(result.current.liveAq?.pm25).toBe(185);
    expect(result.current.plan.report.city.baselinePm25).toBe(185);
    expect(result.current.aqiError).toContain('showing your last valid plan');
  } finally {
    cleanupTestState();
  }
});

it('rejects stale out-of-order external rollbacks and accepts token-only renewals', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const oldReport = computeFullPlan(DEFAULT_PROFILE, {
      pm25: 42, observedAt: '2026-11-28T06:00:00Z',
    }).report;
    const freshLiveAq: LiveAqOverride = { pm25: 90, observedAt: '2026-11-28T09:00:00Z' };
    const freshReport = computeFullPlan(DEFAULT_PROFILE, freshLiveAq).report;
    mockedPostPlan.mockResolvedValue({
      ...computeFullPlan(DEFAULT_PROFILE, freshLiveAq),
      snapshotToken: 'tok-fresh',
    });

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.snapshotToken).toBe('tok-fresh');

    act(() => {
      result.current.syncExternalReport(oldReport, 'tok-old', 'tok-old');
    });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.snapshotToken).toBe('tok-fresh');

    act(() => {
      result.current.syncExternalReport(freshReport, 'tok-renewed', 'tok-fresh');
    });
    expect(result.current.snapshotToken).toBe('tok-renewed');
  } finally {
    cleanupTestState();
  }
});

it('blocks late /api/plan responses from rolling back a fresher assistant snapshot', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const oldPlan = {
      ...computeFullPlan(DEFAULT_PROFILE, { pm25: 42, observedAt: '2026-11-28T06:00:00Z' }),
      snapshotToken: 'tok-old',
    };
    const freshReport = computeFullPlan(DEFAULT_PROFILE, {
      pm25: 90, observedAt: '2026-11-28T09:00:00Z',
    }).report;
    let resolvePlan: ((value: typeof oldPlan) => void) | undefined;
    mockedPostPlan.mockImplementation(
      () => new Promise((resolve) => { resolvePlan = resolve; }),
    );
    mockedPostPlanBriefing.mockResolvedValue({
      ...mockBriefingResponse,
      observationId: resolveReportAq(DEFAULT_PROFILE, {
        pm25: 90, observedAt: '2026-11-28T09:00:00Z',
      }).observationId,
    });

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    act(() => { result.current.syncExternalReport(freshReport, 'tok-fresh', undefined); });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.snapshotToken).toBe('tok-fresh');

    await act(async () => {
      resolvePlan?.(oldPlan);
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.snapshotToken).toBe('tok-fresh');
    expect(mockedPostPlanBriefing).toHaveBeenCalledWith(
      expect.objectContaining({ cityId: DEFAULT_PROFILE.cityId }),
      expect.any(AbortSignal),
      'tok-fresh',
    );
  } finally {
    cleanupTestState();
  }
});

it('ignores stale syncExternalReport closures from an earlier selection revision', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const rev1Aq: LiveAqOverride = { pm25: 250, observedAt: '2026-11-28T10:00:00Z' };
    const staleRev0Report = computeFullPlan(DEFAULT_PROFILE, {
      pm25: 42, observedAt: '2026-11-28T06:00:00Z',
    }).report;
    mockedPostPlan
      .mockResolvedValueOnce({ ...computeFullPlan(DEFAULT_PROFILE, mockLiveAq), snapshotToken: 'tok-0' })
      .mockResolvedValueOnce({ ...computeFullPlan(DEFAULT_PROFILE, rev1Aq), snapshotToken: 'tok-1' });

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    const staleSync = result.current.syncExternalReport;

    act(() => { result.current.selectPresetCity(DEFAULT_PROFILE.cityId); });
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    expect(result.current.liveAq?.pm25).toBe(250);
    expect(result.current.snapshotToken).toBe('tok-1');

    act(() => { staleSync(staleRev0Report, 'tok-old', 'tok-0'); });
    expect(result.current.liveAq?.pm25).toBe(250);
    expect(result.current.snapshotToken).toBe('tok-1');
    expect(result.current.isSyncing).toBe(false);
  } finally {
    cleanupTestState();
  }
});

it.each(['tok-fresh', undefined])('preserves fresher assistant AQ after a stale 503 (token %s)', async (token) => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const customLoc = { name: 'Distant Custom', lat: 28.9, lon: 77.9 };
    const profile = { ...DEFAULT_PROFILE, customLocation: customLoc };
    const freshLive: LiveAqOverride = { pm25: 90, observedAt: '2026-11-28T09:00:00Z' };
    const freshReport = computeFullPlan(profile, freshLive).report;
    const freshObsId = resolveReportAq(profile, freshLive).observationId;
    let rejectPlan: ((err: unknown) => void) | undefined;
    mockedPostPlan.mockImplementation(() => new Promise((_, reject) => { rejectPlan = reject; }));
    mockedPostPlanBriefing.mockResolvedValue({
      ...mockBriefingResponse, observationId: freshObsId,
    });

    const { result } = renderHook(() => useSmogPlan(profile));
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    act(() => { result.current.syncExternalReport(freshReport, token, undefined); });

    await act(async () => {
      rejectPlan?.(new apiClient.ApiError('Unavailable', 503, 'LIVE_AQ_UNAVAILABLE'));
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.snapshotToken).toBe(token);
    expect(result.current.aqiError).toBeUndefined();
    expect(result.current.briefing?.observationId).toBe(freshObsId);
  } finally {
    cleanupTestState();
  }
});

it('refreshes /api/plan/briefing when assistant update lands before dispatch, mid-flight, or post-settle', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const aq42: LiveAqOverride = { pm25: 42, observedAt: '2026-11-28T06:00:00Z' };
    const aq90: LiveAqOverride = { pm25: 90, observedAt: '2026-11-28T09:00:00Z' };
    const obs42 = resolveReportAq(DEFAULT_PROFILE, aq42).observationId;
    const obs90 = resolveReportAq(DEFAULT_PROFILE, aq90).observationId;
    const report90 = computeFullPlan(DEFAULT_PROFILE, aq90).report;
    mockedPostPlan.mockResolvedValue({
      ...computeFullPlan(DEFAULT_PROFILE, aq42), snapshotToken: 'tok-42',
    });

    // Stage 1: before briefing dispatch
    mockedPostPlanBriefing.mockResolvedValue({ ...mockBriefingResponse, observationId: obs90 });
    const hookBefore = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    act(() => { hookBefore.result.current.syncExternalReport(report90, 'tok-90', 'tok-42'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(mockedPostPlanBriefing).toHaveBeenCalledTimes(1);
    expect(mockedPostPlanBriefing).toHaveBeenCalledWith(
      expect.objectContaining({ cityId: DEFAULT_PROFILE.cityId }), expect.any(AbortSignal), 'tok-90',
    );
    expect(hookBefore.result.current.briefing?.observationId).toBe(obs90);
    hookBefore.unmount();

    // Stage 2: during in-flight briefing + Stage 3: post-settle replacement
    mockedPostPlanBriefing.mockReset();
    let resolveInFlight: ((val: PlanBriefingApiResponse) => void) | undefined;
    mockedPostPlanBriefing
      .mockImplementationOnce(() => new Promise((r) => { resolveInFlight = r; }))
      .mockResolvedValueOnce({ ...mockBriefingResponse, observationId: obs90 });
    const hookDuring = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    act(() => { hookDuring.result.current.syncExternalReport(report90, 'tok-90', 'tok-42'); });
    await act(async () => {
      resolveInFlight?.({ ...mockBriefingResponse, observationId: obs42 });
      await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS);
    });
    expect(hookDuring.result.current.briefing?.observationId).toBe(obs90);
    expect(hookDuring.result.current.briefingFailed).toBe(false);
    hookDuring.unmount();

    // Stage 3: post-settle replacement
    const aq95: LiveAqOverride = { pm25: 95, observedAt: '2026-11-28T10:00:00Z' };
    const obs95 = resolveReportAq(DEFAULT_PROFILE, aq95).observationId;
    const report95 = computeFullPlan(DEFAULT_PROFILE, aq95).report;
    mockedPostPlanBriefing
      .mockResolvedValueOnce({ ...mockBriefingResponse, observationId: obs42 })
      .mockResolvedValueOnce({ ...mockBriefingResponse, observationId: obs95 });
    const hookAfter = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(hookAfter.result.current.briefing?.observationId).toBe(obs42);
    act(() => { hookAfter.result.current.syncExternalReport(report95, 'tok-95', 'tok-42'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(hookAfter.result.current.briefing?.observationId).toBe(obs95);
    hookAfter.unmount();
  } finally {
    cleanupTestState();
  }
});

it('clears settled briefing immediately when in-flight /api/plan advances observationId', async () => {
  setupDefaultMocks();
  vi.useFakeTimers();
  try {
    const { computeFullPlan } = await import('../../src/domain/impactService.js');
    const aq42: LiveAqOverride = { pm25: 42, observedAt: '2026-11-28T06:00:00Z' };
    const aq90: LiveAqOverride = { pm25: 90, observedAt: '2026-11-28T09:00:00Z' };
    const obs42 = resolveReportAq(DEFAULT_PROFILE, aq42).observationId;
    const obs90 = resolveReportAq(DEFAULT_PROFILE, aq90).observationId;
    const report42 = computeFullPlan(DEFAULT_PROFILE, aq42).report;
    const plan90 = { ...computeFullPlan(DEFAULT_PROFILE, aq90), snapshotToken: 'tok-90' };
    let resolvePlan: ((val: typeof plan90) => void) | undefined;
    mockedPostPlan.mockImplementation(() => new Promise((r) => { resolvePlan = r; }));
    mockedPostPlanBriefing
      .mockResolvedValueOnce({ ...mockBriefingResponse, observationId: obs42 })
      .mockResolvedValueOnce({ ...mockBriefingResponse, observationId: obs90 });

    const { result } = renderHook(() => useSmogPlan());
    await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS); });
    act(() => { result.current.syncExternalReport(report42, 'tok-42', undefined); });
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(result.current.briefing?.observationId).toBe(obs42);

    await act(async () => { resolvePlan?.(plan90); });
    expect(result.current.liveAq?.pm25).toBe(90);
    expect(result.current.briefing).toBeUndefined();
    expect(result.current.briefingFailed).toBe(false);
    expect(result.current.isBriefingLoading).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(BRIEFING_DEBOUNCE_MS); });
    expect(result.current.briefing?.observationId).toBe(obs90);
    expect(result.current.briefingFailed).toBe(false);
  } finally {
    cleanupTestState();
  }
});
