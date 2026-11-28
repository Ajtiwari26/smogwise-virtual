// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/App.js';
import { AiPlanBriefingCard } from '../../src/components/AiPlanBriefingCard.js';
import { AuthenticatedWorkspace } from '../../src/components/AuthenticatedWorkspace.js';
import { DailyRoutineTimeline } from '../../src/components/DailyRoutineTimeline.js';
import { ErrorBoundary } from '../../src/components/ErrorBoundary.js';
import { GroundedAssistant } from '../../src/components/GroundedAssistant.js';
import { Header } from '../../src/components/Header.js';
import { ImpactDashboard } from '../../src/components/ImpactDashboard.js';
import { PersonaForm } from '../../src/components/PersonaForm.js';
import { RWACommunityPanel } from '../../src/components/RWACommunityPanel.js';
import { ScenarioPresetBar } from '../../src/components/ScenarioPresetBar.js';
import { SmogAlertBanner } from '../../src/components/SmogAlertBanner.js';
import { WhatIfComparator } from '../../src/components/WhatIfComparator.js';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import { computeFullPlan } from '../../src/domain/impactService.js';
import { SAMPLE_SCENARIOS } from '../../src/domain/sampleScenarios.js';
import type {
  CityPreset,
  EmissionsMetrics,
  IAQHackDetail,
  UserProfile,
} from '../../src/domain/types.js';
import { DEFAULT_PROFILE } from '../../src/hooks/useSmogPlan.js';
import * as apiClient from '../../src/services/apiClient.js';

const BASE_CITY: CityPreset = {
  id: 'delhi_anand_vihar',
  name: 'Delhi (Anand Vihar)',
  nameHi: 'दिल्ली (आनंद विहार)',
  state: 'Delhi',
  lat: 28.6469,
  lon: 77.3164,
  baselinePm25: 320,
  baselinePm10: 460,
  baselineNo2: 88,
  grapStage: 'GRAP_IV',
};

const SAMPLE_EMISSIONS: EmissionsMetrics = {
  co2eAvoidedGramsPerDay: 1850,
  pm25AvoidedMgPerDay: 42,
  monthlyNetSavingsInr: 950,
  communityCo2eAvoidedKgPerMonth: 2775,
  communityPm25AvoidedGramsPerMonth: 63,
};

const SAMPLE_HACKS: readonly IAQHackDetail[] = [
  {
    id: 'window_sealing',
    name: 'Door & Window Draft Sealing',
    nameHi: 'दरवाज़े और खिड़की की सीलिंग',
    instructions: 'Seal perimeter gaps.',
    instructionsHi: 'दरवाज़े की दरारें सील करें।',
    monthlyCostInr: 150,
    doseImpactLabel: '-28% outdoor infiltration',
    doseImpactLabelHi: '-28% बाहरी धूल प्रवेश',
    withinBudget: true,
    isActive: true,
  },
  {
    id: 'corsi_rosenthal_box',
    name: 'DIY Corsi-Rosenthal MERV-13 Box',
    nameHi: 'DIY कोर्सी-रोसेन्थल बॉक्स',
    instructions: 'Tape 4 MERV-13 filters to box fan.',
    instructionsHi: 'पंखे पर 4 MERV-13 फ़िल्टर लगाएं।',
    monthlyCostInr: 450,
    doseImpactLabel: '-52% indoor PM2.5',
    withinBudget: false,
    isActive: false,
  },
];

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...DEFAULT_PROFILE, ...overrides };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders EN fallback on child throw and recovers when Reset Panel is clicked', () => {
    let shouldThrow = true;
    const Bomb = (): React.JSX.Element => {
      if (shouldThrow) throw new Error('boom');
      return <p>Healthy child panel</p>;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary language="en">
        <Bomb />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong while rendering this panel.');
    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: 'Reset Panel' }));
    expect(screen.getByText('Healthy child panel')).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
  });

  it('renders Hindi fallback message and reset button when language is hi', () => {
    const Bomb = (): React.JSX.Element => {
      throw new Error('boom-hi');
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary language="hi">
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      'इस अनुभाग को लोड करते समय एक अस्थायी त्रुटि हुई।',
    );
    expect(screen.getByRole('button', { name: 'पुनः प्रयास करें' })).toBeInTheDocument();
  });
});

describe('App sign-out', () => {
  it('retains the authenticated workspace on failure and exits after a successful retry', async () => {
    vi.spyOn(apiClient, 'fetchSession').mockResolvedValue({
      authenticated: true,
      user: {
        id: 'test', name: 'Test User', email: 'test@example.com', personaId: 'young_family',
        defaultLang: 'en', defaultCityId: 'delhi_anand_vihar',
      },
    });
    vi.spyOn(apiClient, 'fetchUserPreferences').mockResolvedValue({ profile: null });
    const logout = vi.spyOn(apiClient, 'logoutSession')
      .mockRejectedValueOnce(new Error('network failure'))
      .mockResolvedValueOnce({ ok: true });
    render(<App />);

    const signOut = await screen.findByRole('button', { name: /Sign Out/i });
    await act(async () => { fireEvent.click(signOut); });
    expect(signOut).toBeInTheDocument();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Could not sign out. Please try again.')).toHaveRole('alert');

    fireEvent.click(signOut);
    await waitFor(() => expect(signOut).not.toBeInTheDocument());
    expect(logout).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Could not sign out. Please try again.')).not.toBeInTheDocument();
  });
});

describe('GroundedAssistant', () => {
  it('submits quick prompt click and renders mode, answer, and citation pills', async () => {
    const spy = vi.spyOn(apiClient, 'postAiAsk').mockResolvedValue({
      answer: 'Ventilate between 2 PM and 4 PM IST.',
      citationsUsed: ['CPCB-GRAP', 'WHO-2021'],
      mode: 'gemini_interactions',
      guardTriggered: false,
      language: 'en',
      report: computeFullPlan(makeProfile()).report,
    });
    const profile = makeProfile();
    render(<GroundedAssistant profile={profile} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'When is the safest time to ventilate today?' }),
    );
    await waitFor(() => {
      expect(screen.getByText('Ventilate between 2 PM and 4 PM IST.')).toBeInTheDocument();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('[CPCB-GRAP]')).toBeInTheDocument();
    expect(screen.getByText('[WHO-2021]')).toBeInTheDocument();
  });

  it.each([
    ['city', { cityId: 'mumbai_bandra' }],
    ['location', { customLocation: { name: 'Bandra', lat: 19.06, lon: 72.83 } }],
    ['language', { language: 'hi' }],
    ['persona', { persona: 'rwa_coordinator' }],
    ['budget', { monthlyBudgetInr: 6000 }],
    ['room volume', { roomVolumeM3: 90 }],
    ['commute mode', { commuteMode: 'metro_bus' }],
    ['commute distance', { commuteDistanceKm: 12 }],
    ['cooking fuel', { cookingFuel: 'induction' }],
    ['household size', { householdSize: 5 }],
    ['vulnerability', { hasVulnerableMember: false }],
    ['active hacks', { activeHacks: ['hepa_purifier'] }],
    ['RWA households', { rwaHouseholds: 145 }],
    ['RWA adoption', { rwaAdoptionRate: 0.3 }],
  ] satisfies [string, Partial<UserProfile>][])(
    'clears the previous reply and aborts pending work when the profile %s changes',
    async (_field, change) => {
      const profile = makeProfile();
      const answer: apiClient.AiAskApiResponse = {
        answer: 'Previous city advice.',
        language: 'en',
        mode: 'offline_grounded',
        citationsUsed: ['AQ:SOURCE'],
        guardTriggered: false,
        report: computeFullPlan(profile).report,
      };
      let resolvePending: ((value: apiClient.AiAskApiResponse) => void) | undefined;
      const spy = vi.spyOn(apiClient, 'postAiAsk')
        .mockResolvedValueOnce(answer)
        .mockImplementationOnce(() => new Promise((resolve) => { resolvePending = resolve; }));
      const { rerender } = render(<GroundedAssistant profile={profile} />);
      const quickPrompt = screen.getByRole('button', {
        name: 'When is the safest time to ventilate today?',
      });
      fireEvent.click(quickPrompt);
      expect(await screen.findByText(answer.answer)).toBeInTheDocument();
      fireEvent.click(quickPrompt);
      const pendingSignal = spy.mock.calls.at(-1)?.[2];
      expect(pendingSignal?.aborted).toBe(false);
      expect(screen.getByRole('button', { name: 'Thinking...' })).toBeDisabled();

      rerender(<GroundedAssistant profile={{ ...profile, ...change }} />);
      expect(pendingSignal?.aborted).toBe(true);
      expect(screen.queryByText(answer.answer)).not.toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(screen.getByRole('button', { name: /^(Ask|पूछें)$/ })).toBeEnabled();

      await act(async () => resolvePending?.({ ...answer, answer: 'Late reply.' }));
      expect(screen.queryByText('Late reply.')).not.toBeInTheDocument();
    },
  );

  it('preserves errors across reordered equivalent fields and clears them on profile changes', async () => {
    const profile = makeProfile({
      customLocation: { state: 'Rajasthan', name: 'Udaipur', lat: 24.58, lon: 73.71 },
    });
    vi.spyOn(apiClient, 'postAiAsk').mockRejectedValue(new Error('network'));
    const { rerender } = render(<GroundedAssistant profile={profile} />);
    const prompt = screen.getByRole('button', { name: 'When is the safest time to ventilate today?' });
    fireEvent.click(prompt);
    const error = await screen.findByRole('alert');
    rerender(<GroundedAssistant profile={{
      ...profile,
      customLocation: { lon: 73.71, lat: 24.58, name: 'Udaipur', state: 'Rajasthan' },
    }} />);
    expect(error).toBeInTheDocument();
    rerender(<GroundedAssistant profile={{ ...profile, monthlyBudgetInr: 6000 }} />);
    expect(error).not.toBeInTheDocument();
  });

  it('handles custom submit, ignores empty submit, shows error, and renders Hindi labels', async () => {
    const spy = vi
      .spyOn(apiClient, 'postAiAsk')
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        answer: 'दोपहर में खिड़कियाँ खोलें।',
        citationsUsed: ['NCAP'],
        mode: 'offline_grounded',
        guardTriggered: true,
        language: 'hi',
        report: computeFullPlan(makeProfile({ language: 'hi' })).report,
      });
    const { rerender } = render(<GroundedAssistant profile={makeProfile()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    expect(spy).not.toHaveBeenCalled();
    const input = screen.getByLabelText('Ask a smog safety question');
    fireEvent.change(input, { target: { value: '  Is N95 needed?  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => {
      expect(
        screen.getByText('Could not reach the assistant. Please try again.'),
      ).toBeInTheDocument();
    });
    rerender(<GroundedAssistant profile={makeProfile({ language: 'hi' })} />);
    expect(screen.getByText('सत्यापित स्मॉग सहायक (Grounded AI)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('अपना प्रश्न पूछें'), { target: { value: 'सलाह दें' } });
    fireEvent.click(screen.getByRole('button', { name: 'पूछें' }));
    await waitFor(() => {
      expect(screen.getByText('दोपहर में खिड़कियाँ खोलें।')).toBeInTheDocument();
    });
    expect(screen.getByText('Guard Active')).toBeInTheDocument();
  });
});

describe('WhatIfComparator', () => {
  it('updates deltas when commute, fuel, and DIY Corsi box change in EN and HI', () => {
    const baseProfile = makeProfile({
      commuteMode: 'petrol_car',
      cookingFuel: 'biomass_chulha',
    });
    const { container, rerender } = render(
      <WhatIfComparator profile={baseProfile} liveAq={undefined} />,
    );
    const commuteSelect = container.querySelector('select#whatif-commute');
    expect(commuteSelect?.querySelector("option[value='two_wheeler']")).not.toBeNull();
    const initialDose = screen.getAllByText(/ug\/day/)[0]?.textContent ?? '';
    fireEvent.change(screen.getByLabelText('Alternative Commute'), {
      target: { value: 'petrol_car' },
    });
    fireEvent.change(screen.getByLabelText('Alternative Fuel'), {
      target: { value: 'biomass_chulha' },
    });
    fireEvent.click(screen.getByLabelText('Add DIY Corsi-Rosenthal Box'));
    const zeroDose = screen.getAllByText(/ug\/day/)[0]?.textContent ?? '';
    expect(zeroDose).not.toBe(initialDose);
    expect(zeroDose).toContain('0 ug/day');
    rerender(
      <WhatIfComparator
        profile={makeProfile({
          language: 'hi',
          commuteMode: 'wfh_walk',
          cookingFuel: 'induction',
        })}
        liveAq={undefined}
      />,
    );
    expect(screen.getByText('क्या होगा यदि? (2-विकल्प तुलना)')).toBeInTheDocument();
    expect(screen.getByText('खुराक कमी')).toBeInTheDocument();
    const hiCommuteSelect = container.querySelector('select#whatif-commute') as HTMLSelectElement;
    const hiFuelSelect = container.querySelector('select#whatif-fuel') as HTMLSelectElement;
    expect(hiCommuteSelect.value).toBe('metro_bus');
    expect(hiFuelSelect.value).toBe('lpg');
  });
});

describe('RWACommunityPanel', () => {
  it('fires slider callbacks and copies notice to clipboard in EN and HI', async () => {
    const onHouseholds = vi.fn();
    const onAdoption = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { rerender } = render(
      <RWACommunityPanel
        households={100}
        adoptionRate={0.5}
        emissions={SAMPLE_EMISSIONS}
        rwaNotice="RWA Alert Notice"
        language="en"
        onHouseholdsChange={onHouseholds}
        onAdoptionChange={onAdoption}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Households in Society/), { target: { value: '220' } });
    fireEvent.change(screen.getByLabelText(/Adoption Rate/), { target: { value: '75' } });
    expect(onHouseholds).toHaveBeenCalledWith(220);
    expect(onAdoption).toHaveBeenCalledWith(0.75);
    fireEvent.click(screen.getByRole('button', { name: 'Copy RWA Notice' }));
    await waitFor(() => {
      expect(screen.getByText('Copied to clipboard!')).toBeInTheDocument();
    });
    expect(writeText).toHaveBeenCalledWith('RWA Alert Notice');
    rerender(
      <RWACommunityPanel
        households={100}
        adoptionRate={0.5}
        emissions={SAMPLE_EMISSIONS}
        rwaNotice="RWA हिंदी नोटिस"
        language="hi"
        onHouseholdsChange={onHouseholds}
        onAdoptionChange={onAdoption}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'RWA नोटिस कॉपी करें' }));
    await waitFor(() => {
      expect(screen.getByText('कॉपी हो गया!')).toBeInTheDocument();
    });
  });
});

describe('SmogAlertBanner', () => {
  it.each([
    { pm25: 300, hacks: ['window_sealing', 'ventilation_window'], open: false },
    { pm25: 75, hacks: ['window_sealing', 'hepa_purifier', 'ventilation_window'], open: false },
    { pm25: 1, hacks: ['window_sealing', 'ventilation_window'], open: true },
  ] satisfies { pm25: number; hacks: UserProfile['activeHacks']; open: boolean }[])(
    'matches ventilation advice to the routine at PM2.5 $pm25',
    async ({ pm25, hacks, open }) => {
      const profile = makeProfile({
        roomVolumeM3: 12, cookingFuel: 'biomass_chulha', activeHacks: hacks,
      });
      const plan = computeFullPlan(profile, { pm25 });
      vi.spyOn(apiClient, 'fetchUserPreferences').mockResolvedValue({ profile });
      vi.spyOn(apiClient, 'readResponseEtag').mockReturnValue('"v1"');
      vi.spyOn(apiClient, 'postPlan').mockResolvedValue(plan);
      vi.spyOn(apiClient, 'fetchAqi').mockResolvedValue({
        city: plan.report.city, dataSource: plan.report.dataSource, cpcbAqi: plan.report.cpcbAqi,
        aqiBand: plan.report.aqiBand, dominantPollutant: plan.report.dominantPollutant,
        fetchedAt: '2026-01-01T01:00:00Z', liveAq: { pm25 },
      });
      const briefing = vi.spyOn(apiClient, 'postPlanBriefing');
      briefing.mockRejectedValue(new Error('mock briefing unavailable'));
      render(
        <AuthenticatedWorkspace
          authUser={{
            id: 'test', name: 'Test User', email: 'test@example.com',
            personaId: profile.persona, defaultLang: 'en', defaultCityId: profile.cityId,
          }}
          onSignOut={vi.fn()}
        />,
      );
      const expectedAction = open
        ? /ventilate only while/i : /keep windows closed in the afternoon/i;
      const banner = screen.getByRole('region', { name: plan.report.city.name });
      await waitFor(() => {
        expect(banner).toHaveTextContent(`PM2.5: ${String(pm25)} ug/m3`);
        expect(banner).toHaveTextContent(expectedAction);
      });
      expect(screen.getByRole('region', { name: 'Low-Emission Daily Routine' })).toHaveTextContent(
        open ? /cross-ventilate for 20-30 minutes/i : /keep windows closed and wet-mop/i,
      );
    },
  );

  it('marks a distant custom location (>50 km) unavailable without displaying fake proxy readings', async () => {
    const profile = makeProfile({
      customLocation: { name: 'Udaipur', state: 'Rajasthan', lat: 24.5854, lon: 73.7125 },
    });
    const unavailable = new apiClient.ApiError('Unavailable', 503, 'LIVE_AQ_UNAVAILABLE');
    vi.spyOn(apiClient, 'fetchUserPreferences').mockResolvedValue({ profile });
    vi.spyOn(apiClient, 'readResponseEtag').mockReturnValue('"v1"');
    vi.spyOn(apiClient, 'fetchAqiByCoords').mockRejectedValue(unavailable);
    vi.spyOn(apiClient, 'postPlan').mockRejectedValue(unavailable);
    vi.spyOn(apiClient, 'postPlanBriefing').mockRejectedValue(unavailable);
    render(
      <AuthenticatedWorkspace
        authUser={{
          id: 'test', name: 'Test User', email: 'test@example.com',
          personaId: profile.persona, defaultLang: 'en', defaultCityId: profile.cityId,
        }}
        onSignOut={vi.fn()}
      />,
    );
    const banner = await screen.findByRole('region', { name: 'Udaipur, Rajasthan' });
    await waitFor(() => expect(banner).toHaveTextContent('temporarily unavailable'));
    expect(banner).toHaveTextContent(`Nearest station: ${resolveCityPreset('jaipur').name}`);
    expect(banner).toHaveTextContent('outside 50 km fallback range');
    expect(banner).toHaveTextContent('Local station readings unavailable');
    expect(banner).not.toHaveTextContent('PM2.5:');
    expect(screen.queryByRole('region', { name: 'Direct Health & Emissions Impact' }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Low-Emission Daily Routine' }))
      .not.toBeInTheDocument();
    expect(document.getElementById('what-if')).toBeNull();
    expect(document.getElementById('ai-briefing-heading')).toBeNull();
  });

  it('renders assertive alert for Severe/GRAP_IV and classifies all lower CPCB bands', () => {
    const bands: readonly [number, string][] = [
      [40, 'Good'],
      [85, 'Satisfactory'],
      [160, 'Moderate'],
      [250, 'Poor'],
      [360, 'Very Poor'],
    ];
    const { rerender } = render(
      <SmogAlertBanner
        city={BASE_CITY}
        language="en"
        optimalVentilationWindow="14:00–16:00 IST"
        cpcbAqi={430}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('CPCB AQI 430 · Severe');
    const mildCity: CityPreset = { ...BASE_CITY, grapStage: 'NONE' };
    for (const [aqi, label] of bands) {
      rerender(
        <SmogAlertBanner
          city={mildCity}
          language="en"
          optimalVentilationWindow="14:00–16:00 IST"
          cpcbAqi={aqi}
        />,
      );
      expect(screen.getByRole('status')).toHaveTextContent(`CPCB AQI ${aqi} · ${label}`);
    }
  });

  it('handles live_open_meteo timestamps, fallback station, aqiError, and Hindi mode', () => {
    const { rerender } = render(
      <SmogAlertBanner
        city={BASE_CITY}
        language="en"
        optimalVentilationWindow="14:00–16:00 IST"
        dataSource="live_open_meteo"
        observedAt="2026-11-15T09:30:00Z"
        fallbackStationName="ITO Station"
        fallbackDistanceKm={4.2}
        aqiError="Using cached reading"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Live Open-Meteo');
    expect(alert).toHaveTextContent('IST');
    expect(alert).toHaveTextContent('Nearest station proxy: ITO Station (4.2 km away)');
    expect(alert).toHaveTextContent('Using cached reading');
    rerender(
      <SmogAlertBanner
        city={BASE_CITY}
        language="hi"
        optimalVentilationWindow="14:00–16:00 IST"
        dataSource="live_open_meteo"
        observedAt="not-a-valid-date"
        fallbackStationName="ITO Station"
      />,
    );
    const hiAlert = screen.getByRole('alert');
    expect(hiAlert).toHaveTextContent('लाइव Open-Meteo');
    expect(hiAlert).not.toHaveTextContent('· NaN');
    expect(hiAlert).toHaveTextContent('निकटतम स्टेशन प्रॉक्सी: ITO Station');
  });
});

describe('SmogAlertBanner live pollutant provenance', () => {
  it('renders live PM10 and NO2 provenance only when provided', () => {
    const { rerender } = render(
      <SmogAlertBanner
        city={BASE_CITY}
        language="en"
        optimalVentilationWindow="14:00–16:00 IST"
        dataSource="live_open_meteo"
      />,
    );
    const banner = screen.getByRole('alert');
    expect(banner).not.toHaveTextContent('PM10:');
    expect(banner).not.toHaveTextContent('NO2:');
    rerender(
      <SmogAlertBanner
        city={BASE_CITY}
        language="en"
        optimalVentilationWindow="14:00–16:00 IST"
        dataSource="live_open_meteo"
        livePm10={180}
        liveNo2={45}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('PM10: 180 ug/m3');
    expect(screen.getByRole('alert')).toHaveTextContent('NO2: 45 ug/m3');
  });
});

describe('PersonaForm', () => {
  it('rejects invalid fields, preserves decimals, and dispatches select, checkbox, and hack toggles', () => {
    const onUpdate = vi.fn();
    const onToggleHack = vi.fn();
    render(
      <PersonaForm
        profile={makeProfile()}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={onUpdate}
        onToggleHack={onToggleHack}
      />,
    );
    fireEvent.change(screen.getByLabelText('Household Size'), { target: { value: '99' } });
    fireEvent.change(screen.getByLabelText('Monthly Budget (₹)'), { target: { value: '-50' } });
    fireEvent.change(screen.getByLabelText('Room Volume (m³)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Commute (km/day)'), { target: { value: '400' } });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Household Size')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(screen.getByLabelText('Household Size'), { target: { value: '3.5' } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Room Volume (m³)'), { target: { value: '33.5' } });
    expect(onUpdate).toHaveBeenCalledWith({ roomVolumeM3: 33.5 });
    expect(screen.getByText('Over budget')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Household Persona'), {
      target: { value: 'rwa_coordinator' },
    });
    fireEvent.change(screen.getByLabelText('Commute Mode'), { target: { value: 'metro_bus' } });
    fireEvent.change(screen.getByLabelText('Cooking Fuel'), { target: { value: 'induction' } });
    fireEvent.change(screen.getByLabelText('Or Select Major City Preset'), {
      target: { value: 'gurugram_dlf' },
    });
    fireEvent.click(screen.getByLabelText('Vulnerable member (child / elderly / asthma)'));
    fireEvent.click(screen.getByLabelText(/DIY Corsi-Rosenthal MERV-13 Box/));
    expect(onUpdate).toHaveBeenCalledWith({ persona: 'rwa_coordinator' });
    expect(onUpdate).toHaveBeenCalledWith({ commuteMode: 'metro_bus' });
    expect(onUpdate).toHaveBeenCalledWith({ cookingFuel: 'induction' });
    expect(onUpdate).toHaveBeenCalledWith({ cityId: 'gurugram_dlf' });
    expect(onUpdate).toHaveBeenCalledWith({ hasVulnerableMember: false });
    expect(onToggleHack).toHaveBeenCalledWith('corsi_rosenthal_box');
    const personaSelect = screen.getByLabelText('Household Persona');
    expect(personaSelect.querySelector('option[value="office_commuter"]')).not.toBeNull();
    expect(personaSelect.querySelector('option[value="outdoor_student"]')).not.toBeNull();
  });

  it('renders customLocation option and Hindi doseImpactLabelHi in HackChecklist', () => {
    const customLocation = { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 };
    const { container, rerender } = render(
      <PersonaForm
        profile={makeProfile({ language: 'en', customLocation })}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={vi.fn()}
        onToggleHack={vi.fn()}
      />,
    );
    const customOpt = container.querySelector(
      "#form-city-select option[value='__custom_location__']",
    );
    expect(customOpt).not.toBeNull();
    expect(customOpt?.textContent).toBe('Custom: Jaipur');

    rerender(
      <PersonaForm
        profile={makeProfile({ language: 'hi', customLocation })}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={vi.fn()}
        onToggleHack={vi.fn()}
      />,
    );
    expect(screen.getByText('-28% बाहरी धूल प्रवेश')).toBeInTheDocument();
  });
});

describe('Header and AiPlanBriefingCard', () => {
  it('Header custom city sync', () => {
    const onCityChange = vi.fn();
    const customCity: CityPreset = {
      ...BASE_CITY,
      id: 'custom_indore',
      name: 'Indore, Madhya Pradesh',
      nameHi: 'Indore, Madhya Pradesh',
    };
    render(
      <Header
        city={customCity}
        language="en"
        dataSource="live_open_meteo"
        isSyncing={false}
        onCityChange={onCityChange}
        onLanguageChange={vi.fn()}
      />,
    );
    const select = document.getElementById('header-city-select') as HTMLSelectElement;
    expect(select.value).toBe('custom_indore');
    expect(screen.getByRole('option', { name: 'Indore, Madhya Pradesh' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'delhi_anand_vihar' } });
    expect(onCityChange).toHaveBeenCalledWith('delhi_anand_vihar');
  });

  it('renders Tier-1 Grounded Summary and aria-busy when loading', () => {
    const { report } = computeFullPlan(makeProfile());
    const { container } = render(
      <AiPlanBriefingCard
        report={report}
        briefing={undefined}
        isLoading={true}
        language="en"
      />,
    );
    expect(screen.getByText('Tier-1 Grounded Summary')).toBeInTheDocument();
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('ScenarioPresetBar', () => {
  it('invokes ScenarioPresetBar directly and inside PersonaForm with and without callbacks', () => {
    const firstScenario = SAMPLE_SCENARIOS[0];
    expect(firstScenario?.id).toBe('delhi_young_family');
    if (firstScenario === undefined) return;
    const onSelect = vi.fn();
    const { rerender } = render(
      <ScenarioPresetBar
        language="en"
        activeScenarioId={firstScenario.id}
        onSelectScenario={onSelect}
      />,
    );
    const chip = screen.getByRole('button', { name: firstScenario.labelEn });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).not.toHaveAttribute('lang');
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(firstScenario.id, firstScenario.profile);

    rerender(
      <ScenarioPresetBar
        language="hi"
        activeScenarioId={firstScenario.id}
        onSelectScenario={onSelect}
      />,
    );
    const hiChip = screen.getByRole('button', { name: firstScenario.labelHi });
    expect(hiChip).toHaveAttribute('lang', 'hi');

    const onUpdate = vi.fn();
    const onApplyScenario = vi.fn();
    const onSelectPresetCity = vi.fn();
    rerender(
      <PersonaForm
        profile={makeProfile()}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={onUpdate}
        onToggleHack={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: firstScenario.labelEn }));
    expect(onUpdate).toHaveBeenCalledWith(firstScenario.profile);

    rerender(
      <PersonaForm
        profile={makeProfile()}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={onUpdate}
        onToggleHack={vi.fn()}
        onApplyScenario={onApplyScenario}
        onSelectPresetCity={onSelectPresetCity}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: firstScenario.labelEn }));
    expect(onApplyScenario).toHaveBeenCalledWith(firstScenario.profile);
    fireEvent.change(screen.getByLabelText('Or Select Major City Preset'), {
      target: { value: 'noida_sec62' },
    });
    expect(onSelectPresetCity).toHaveBeenCalledWith('noida_sec62');
  });

  it('covers Hindi charts, citations <details>, routine badges, and clipboard failure in RWACommunityPanel', async () => {
    const hiProfile = makeProfile({ language: 'hi' });
    const planHi = computeFullPlan(hiProfile, {
      pm25: 290,
      pm10: 360,
      no2: 52,
      observedAt: '2026-11-26T09:00:00+05:30',
      fallbackStationName: 'Delhi Anand Vihar',
      fallbackDistanceKm: 12.4,
    });
    const { container } = render(
      <div>
        <ImpactDashboard report={planHi.report} language="hi" />
        <AiPlanBriefingCard
          report={planHi.report}
          briefing={{
            headline: 'मुख्य सलाह',
            summary: 'आज खुराक घटेगी [CALC:DOSE_AFTER]',
            whyActions: ['खिड़कियां सील करें'],
            language: 'hi',
            mode: 'gemini_interactions',
            citationsUsed: ['CALC:DOSE_AFTER', 'AQ:SOURCE'],
          }}
          isLoading={false}
          language="hi"
        />
        <DailyRoutineTimeline
          routine={planHi.routine}
          optimalVentilationWindow="13:00 - 16:00"
          language="hi"
        />
      </div>,
    );
    const svgEl = container.querySelector('svg[aria-describedby]');
    const descId = svgEl?.getAttribute('aria-describedby') ?? '';
    expect(descId.length).toBeGreaterThan(0);
    expect(document.getElementById(descId)?.tagName.toLowerCase()).toBe('table');
    expect(screen.getByText('मुख्य सलाह')).toBeInTheDocument();
    expect(container.querySelector('details')).not.toBeNull();
    expect(screen.getByText(/कम-उत्सर्जन दैनिक दिनचर्या/)).toBeInTheDocument();

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    render(
      <RWACommunityPanel
        households={80}
        adoptionRate={0.5}
        emissions={planHi.report.emissions}
        rwaNotice="Test notice"
        language="hi"
        onHouseholdsChange={vi.fn()}
        onAdoptionChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'RWA नोटिस कॉपी करें' }));
    await waitFor(() => {
      expect(screen.getByText(/क्लिपबोर्ड उपलब्ध नहीं/)).toBeInTheDocument();
    });
  });

  it('handles RWACommunityPanel missing clipboard, status reset timer, and PersonaForm standalone location fallback', async () => {
    vi.useFakeTimers();
    try {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      const { report } = computeFullPlan(makeProfile());
      render(
        <RWACommunityPanel
          households={100}
          adoptionRate={0.5}
          emissions={report.emissions}
          rwaNotice="Test notice"
          language="en"
          onHouseholdsChange={vi.fn()}
          onAdoptionChange={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Copy RWA Notice' }));
      expect(screen.getByText(/Clipboard unavailable/)).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2500);
      });
      expect(screen.queryByText(/Clipboard unavailable/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }

    const onUpdate = vi.fn();
    const { container } = render(
      <PersonaForm
        profile={makeProfile()}
        iaqHacks={SAMPLE_HACKS}
        onUpdate={onUpdate}
        onToggleHack={vi.fn()}
      />,
    );
    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    if (form !== null) {
      fireEvent.submit(form);
    }
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('shows AQ:SOURCE and over-budget preview wording in AiPlanBriefingCard, validates high RWA bounds, and keeps WhatIf comparator unchanged across RWA-only edits', () => {
    const profile = makeProfile();
    const { report } = computeFullPlan(profile);
    render(
      <AiPlanBriefingCard
        report={report}
        briefing={undefined}
        isLoading={false}
        language="en"
        hasOverBudgetSelection={true}
      />,
    );
    expect(screen.getByText(/total monthly cost of selected actions exceeds your budget/i))
      .toBeInTheDocument();
    expect(screen.queryByText(/within budget/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(/AQ:SOURCE/).length).toBeGreaterThanOrEqual(1);

    const onHouseholdsChange = vi.fn();
    render(
      <RWACommunityPanel
        households={1500}
        adoptionRate={0.05}
        emissions={report.emissions}
        rwaNotice="Society notice"
        language="en"
        onHouseholdsChange={onHouseholdsChange}
        onAdoptionChange={vi.fn()}
      />,
    );
    const flatsSlider = screen.getByLabelText(/Households in Society/i);
    expect(flatsSlider).toHaveAttribute('max', '5000');
    expect(flatsSlider).toHaveAttribute('aria-valuetext', '1500');
    expect(screen.getByLabelText(/Adoption Rate:\s*5%/i)).toHaveAttribute('aria-valuetext', '5%');

    const { rerender, container } = render(
      <WhatIfComparator profile={profile} liveAq={undefined} />,
    );
    const initialText = container.querySelector('#what-if')?.textContent ?? '';
    rerender(
      <WhatIfComparator
        profile={{ ...profile, rwaHouseholds: 1800, rwaAdoptionRate: 0.9 }}
        liveAq={undefined}
      />,
    );
    expect(container.querySelector('#what-if')?.textContent ?? '').toBe(initialText);
  });

  it('disables Header controls during sign-out and omits dead nav links when local AQ is unavailable', () => {
    render(
      <Header
        city={BASE_CITY}
        language="en"
        aqUnavailable={true}
        hasLocalSections={false}
        isSigningOut={true}
        onCityChange={vi.fn()}
        onLanguageChange={vi.fn()}
        isAuthenticated={true}
        authUser={{
          id: 'eval_family',
          email: 'family.eval@smogwise.in',
          name: 'Delhi Family',
          personaId: 'young_family',
          defaultLang: 'en',
          defaultCityId: 'delhi_anand_vihar',
        }}
        onSignOut={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/City/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EN' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'हिन्दी' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Sign Out/i })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Impact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Routine' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'What-If' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RWA' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Assistant' })).toBeInTheDocument();
  });

  it('keeps identical WhatIf delta at zero despite stale liveAq & forwards snapshotToken', async () => {
    const profile = makeProfile({ commuteMode: 'petrol_car', cookingFuel: 'biomass_chulha' });
    const liveReport = computeFullPlan(profile, { pm25: 250, observedAt: '2026-11-28T08:00' }).report;
    const { container } = render(
      <WhatIfComparator
        profile={profile}
        liveAq={{ pm25: 42, observedAt: '2026-11-28T06:00' }}
        report={liveReport}
      />,
    );
    fireEvent.change(screen.getByLabelText('Alternative Commute'), {
      target: { value: 'petrol_car' },
    });
    fireEvent.change(screen.getByLabelText('Alternative Fuel'), {
      target: { value: 'biomass_chulha' },
    });
    fireEvent.click(screen.getByLabelText('Add DIY Corsi-Rosenthal Box'));
    expect(container.querySelector('#what-if')?.textContent ?? '').toContain('0 ug/day');

    const askSpy = vi.spyOn(apiClient, 'postAiAsk').mockResolvedValue({
      answer: 'Grounded reply [AQ:SOURCE]',
      language: 'en',
      mode: 'offline_grounded',
      citationsUsed: ['AQ:SOURCE'],
      guardTriggered: false,
      report: liveReport,
    });
    render(
      <GroundedAssistant
        profile={profile}
        observationId={liveReport.observationId}
        snapshotToken="tok-123"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'When is the safest time to ventilate today?' }));
    expect(askSpy).toHaveBeenCalledWith(
      'When is the safest time to ventilate today?',
      profile,
      expect.any(AbortSignal),
      'tok-123',
    );
  });

  it('keeps in-flight budget answers across observationId settlement and syncs newer report', async () => {
    const profile = makeProfile();
    const freshReport = computeFullPlan(profile, { pm25: 90, observedAt: '2026-11-28T09:00' }).report;
    let resolveAsk: ((value: apiClient.AiAskApiResponse) => void) | undefined;
    vi.spyOn(apiClient, 'postAiAsk').mockImplementation(
      () => new Promise((resolve) => { resolveAsk = resolve; }),
    );
    const onSyncReport = vi.fn();
    const { rerender } = render(
      <GroundedAssistant
        profile={profile}
        observationId={undefined}
        onSyncReport={onSyncReport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'How can I cut indoor PM2.5 under ₹500/month?' }));
    rerender(
      <GroundedAssistant
        profile={profile}
        observationId="initial-obs"
        snapshotToken="tok-init"
        onSyncReport={onSyncReport}
      />,
    );
    await act(async () => resolveAsk?.({
      answer: 'Budget under ₹500/month ready',
      language: 'en',
      mode: 'offline_grounded',
      citationsUsed: [],
      guardTriggered: false,
      snapshotToken: 'tok-fresh',
      report: freshReport,
    }));
    expect(screen.getByText('Budget under ₹500/month ready')).toBeInTheDocument();
    expect(onSyncReport).toHaveBeenCalledWith(freshReport, 'tok-fresh', undefined);
  });

  it('forwards token-only renewal to onSyncReport even when observationId is unchanged', async () => {
    const profile = makeProfile();
    const sameReport = computeFullPlan(profile, { pm25: 90, observedAt: '2026-11-28T09:00' }).report;
    const onSyncReport = vi.fn();
    vi.spyOn(apiClient, 'postAiAsk').mockResolvedValue({
      answer: 'Refreshed reply [AQ:SOURCE]',
      language: 'en',
      mode: 'offline_grounded',
      citationsUsed: ['AQ:SOURCE'],
      guardTriggered: false,
      snapshotToken: 'tok-renewed',
      report: sameReport,
    });
    render(
      <GroundedAssistant
        profile={profile}
        observationId={sameReport.observationId}
        snapshotToken="tok-old"
        onSyncReport={onSyncReport}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'When is the safest time to ventilate today?' }));
    await waitFor(() => {
      expect(onSyncReport).toHaveBeenCalledWith(sameReport, 'tok-renewed', 'tok-old');
    });
  });

  it('drops late assistant replies from an earlier selectionRevision even if signal was ignored', async () => {
    const profile = makeProfile();
    const staleReport = computeFullPlan(profile, { pm25: 90, observedAt: '2026-11-28T09:00' }).report;
    let resolveAsk: ((value: apiClient.AiAskApiResponse) => void) | undefined;
    vi.spyOn(apiClient, 'postAiAsk').mockImplementation(
      () => new Promise((resolve) => { resolveAsk = resolve; }),
    );
    const onSyncReport = vi.fn();
    const { rerender } = render(
      <GroundedAssistant profile={profile} selectionRevision={0} onSyncReport={onSyncReport} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'When is the safest time to ventilate today?' }));
    rerender(
      <GroundedAssistant profile={profile} selectionRevision={1} onSyncReport={onSyncReport} />,
    );
    await act(async () => resolveAsk?.({
      answer: 'Stale rev-0 reply',
      language: 'en',
      mode: 'offline_grounded',
      citationsUsed: [],
      guardTriggered: false,
      snapshotToken: 'tok-stale-rev',
      report: staleReport,
    }));
    expect(onSyncReport).not.toHaveBeenCalled();
    expect(screen.queryByText('Stale rev-0 reply')).not.toBeInTheDocument();
  });
});
