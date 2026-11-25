import React from 'react';
import { AiPlanBriefingCard } from './components/AiPlanBriefingCard.js';
import { DailyRoutineTimeline } from './components/DailyRoutineTimeline.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { GroundedAssistant } from './components/GroundedAssistant.js';
import { Header } from './components/Header.js';
import { ImpactDashboard } from './components/ImpactDashboard.js';
import { PersonaForm } from './components/PersonaForm.js';
import { RWACommunityPanel } from './components/RWACommunityPanel.js';
import { SmogAlertBanner, type SmogAlertBannerProps } from './components/SmogAlertBanner.js';
import { WhatIfComparator } from './components/WhatIfComparator.js';
import { useSmogPlan, type UseSmogPlanResult } from './hooks/useSmogPlan.js';

function pickBannerField<K extends keyof SmogAlertBannerProps>(
  key: K,
  primary: SmogAlertBannerProps[K] | undefined,
  fallback: SmogAlertBannerProps[K] | undefined,
): Partial<SmogAlertBannerProps> {
  const val = primary ?? fallback;
  return val !== undefined ? { [key]: val } : {};
}

function buildBannerProps(state: UseSmogPlanResult): SmogAlertBannerProps {
  const { profile, plan, aqMeta, aqiError } = state;
  const { report } = plan;
  return {
    city: report.city,
    language: profile.language,
    optimalVentilationWindow: report.exposure.optimalVentilationWindow,
    ...pickBannerField('dataSource', aqMeta?.dataSource, report.dataSource),
    ...pickBannerField('cpcbAqi', aqMeta?.cpcbAqi, report.cpcbAqi),
    ...pickBannerField('dominantPollutant', aqMeta?.dominantPollutant, report.dominantPollutant),
    ...pickBannerField('observedAt', aqMeta?.observedAt, report.observedAt),
    ...pickBannerField('fallbackStationName', aqMeta?.fallbackStationName, report.fallbackStationName),
    ...pickBannerField('fallbackDistanceKm', aqMeta?.fallbackDistanceKm, report.fallbackDistanceKm),
    ...pickBannerField('aqiError', aqiError, undefined),
  };
}

function AppMainColumns({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  const {
    profile,
    plan,
    liveAq,
    briefing,
    isBriefingLoading,
    updateProfile,
    toggleHack,
    selectLocation,
    selectPresetCity,
    applySampleScenario,
    updateRwaHouseholds,
    updateRwaAdoptionRate,
  } = state;
  const { report, routine, iaqHacks, rwaNotice, citations } = plan;
  const indoorTargetCitation = citations['CALC:INDOOR_TARGET'];
  const plantsVsHepaCitation = citations['SCI:PLANTS_VS_HEPA'];

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <PersonaForm
          profile={profile}
          iaqHacks={iaqHacks}
          onUpdate={updateProfile}
          onToggleHack={toggleHack}
          onSelectLocation={selectLocation}
          onSelectPresetCity={selectPresetCity}
          onApplyScenario={applySampleScenario}
        />
      </div>

      <div className="space-y-5 lg:col-span-8">
        <ImpactDashboard report={report} language={profile.language} />
        <AiPlanBriefingCard
          report={report}
          briefing={briefing}
          isLoading={isBriefingLoading}
          language={profile.language}
        />
        <DailyRoutineTimeline
          routine={routine}
          optimalVentilationWindow={report.exposure.optimalVentilationWindow}
          language={profile.language}
          {...(indoorTargetCitation !== undefined ? { indoorTargetCitation } : {})}
          {...(plantsVsHepaCitation !== undefined ? { plantsVsHepaCitation } : {})}
        />
        <WhatIfComparator profile={profile} liveAq={liveAq} />
        <RWACommunityPanel
          households={profile.rwaHouseholds ?? 120}
          adoptionRate={profile.rwaAdoptionRate ?? 0.45}
          emissions={report.emissions}
          rwaNotice={rwaNotice}
          language={profile.language}
          onHouseholdsChange={updateRwaHouseholds}
          onAdoptionChange={updateRwaAdoptionRate}
        />
        <GroundedAssistant profile={profile} />
      </div>
    </div>
  );
}

/** Root SmogWise Virtual application layout with WCAG 2.1 AA landmarks. */
export const App: React.FC = function App() {
  const state = useSmogPlan();
  const { profile, plan, aqMeta, isSyncing, setLanguage, selectPresetCity } = state;
  const { report } = plan;
  const isHi = profile.language === 'hi';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        city={report.city}
        language={profile.language}
        dataSource={aqMeta?.dataSource ?? report.dataSource}
        isSyncing={isSyncing}
        onCityChange={selectPresetCity}
        onLanguageChange={setLanguage}
      />

      <main id="main-content" className="mx-auto max-w-7xl space-y-4 px-4 py-5">
        <SmogAlertBanner {...buildBannerProps(state)} />
        <ErrorBoundary language={profile.language}>
          <AppMainColumns state={state} />
        </ErrorBoundary>
      </main>

      <footer className="mt-8 border-t border-slate-300 bg-white py-4 text-center text-xs text-slate-700">
        {isHi
          ? 'SmogWise Virtual · सत्यापित Tier-1 भौतिकी मॉडल + ग्राउंडेड AI मार्गदर्शन'
          : 'SmogWise Virtual · Deterministic Tier-1 Physics Engine + Grounded AI Guidance'}
      </footer>
    </div>
  );
};

export default App;
