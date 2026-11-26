// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiPlanBriefingCard } from '../../src/components/AiPlanBriefingCard.js';
import { ErrorBoundary } from '../../src/components/ErrorBoundary.js';
import { GroundedAssistant } from '../../src/components/GroundedAssistant.js';
import { Header } from '../../src/components/Header.js';
import { PersonaForm } from '../../src/components/PersonaForm.js';
import { RWACommunityPanel } from '../../src/components/RWACommunityPanel.js';
import { ScenarioPresetBar } from '../../src/components/ScenarioPresetBar.js';
import { SmogAlertBanner } from '../../src/components/SmogAlertBanner.js';
import { WhatIfComparator } from '../../src/components/WhatIfComparator.js';
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
    withinBudget: true,
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
    expect(alert).toHaveTextContent('Nearest station fallback: ITO Station (4.2 km away)');
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
  it('clamps numeric fields and dispatches select, checkbox, and hack toggles', () => {
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
    expect(onUpdate).toHaveBeenCalledWith({ householdSize: 12 });
    expect(onUpdate).toHaveBeenCalledWith({ monthlyBudgetInr: 0 });
    expect(onUpdate).toHaveBeenCalledWith({ roomVolumeM3: 12 });
    expect(onUpdate).toHaveBeenCalledWith({ commuteDistanceKm: 150 });
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
    expect(firstScenario).toBeDefined();
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
    fireEvent.click(chip);
    expect(onSelect).toHaveBeenCalledWith(firstScenario.id, firstScenario.profile);

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
});
