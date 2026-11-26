// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  cpcbAqi: 348,
  dominantPollutant: 'PM2.5',
  sourceLabel: 'live_open_meteo',
  observedAt: '2026-11-25T15:00:00Z',
};

const mockAqiResponse: AqiApiResponse = {
  city: resolveCityPreset('delhi_anand_vihar'),
  dataSource: 'live_open_meteo',
  cpcbAqi: 348,
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

  it('sets customLocation and triggers fetchAqiByCoords on selectLocation', async () => {
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

    expect(mockedFetchAqiByCoords).toHaveBeenCalledWith(
      23.2156,
      77.4305,
      'Arera Colony',
      'Madhya Pradesh',
      expect.any(AbortSignal),
    );
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
    expect(result.current.profile.customLocation).toBeDefined();

    act(() => {
      result.current.selectPresetCity('mumbai_bandra');
    });

    expect(result.current.profile.cityId).toBe('mumbai_bandra');
    expect(result.current.profile.customLocation).toBeUndefined();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    });

    expect(mockedFetchAqi).toHaveBeenCalledWith('mumbai_bandra', expect.any(AbortSignal));
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

    act(() => {
      result.current.updateRwaHouseholds(250);
      result.current.updateRwaAdoptionRate(0.75);
    });

    expect(result.current.briefing).toEqual(mockBriefingResponse);
  });
});

describe('useSmogPlan error states', () => {
  beforeEach(setupDefaultMocks);
  afterEach(cleanupTestState);

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
});
