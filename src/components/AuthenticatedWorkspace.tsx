/**
 * Authenticated main workspace view with race-safe preference synchronization and ErrorBoundary.
 */

import React from 'react';
import { sumActiveHacksCostInr } from '../domain/emissionsEngine.js';
import { getAfternoonVentilation } from '../domain/ventilation.js';
import { usePreferenceSync } from '../hooks/usePreferenceSync.js';
import { useSmogPlan, type UseSmogPlanResult } from '../hooks/useSmogPlan.js';
import type { AuthUser } from '../services/apiClient.js';
import { AiPlanBriefingCard } from './AiPlanBriefingCard.js';
import { AppFooter } from './AppFooter.js';
import { DailyRoutineTimeline } from './DailyRoutineTimeline.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { GroundedAssistant } from './GroundedAssistant.js';
import { Header } from './Header.js';
import { ImpactDashboard } from './ImpactDashboard.js';
import { PersonaForm } from './PersonaForm.js';
import { RWACommunityPanel } from './RWACommunityPanel.js';
import { SmogAlertBanner, type SmogAlertBannerProps } from './SmogAlertBanner.js';
import { WhatIfComparator } from './WhatIfComparator.js';
import { WorkspaceAlerts } from './WorkspaceAlerts.js';

function buildBannerProps(state: UseSmogPlanResult): SmogAlertBannerProps {
  const { profile, plan, aqiError } = state;
  const { report } = plan;
  return {
    ...report,
    language: profile.language,
    optimalVentilationWindow: report.exposure.optimalVentilationWindow,
    canVentilate: getAfternoonVentilation(report).canVentilate,
    ...(aqiError !== undefined ? { aqiError } : {}),
  };
}

function LocalResults({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  const { profile, plan, householdReport, liveAq, briefing, isBriefingLoading, briefingFailed } =
    state;
  const { language } = profile;
  const { report, routine, citations } = plan;
  const indoorTargetCitation = citations['CALC:INDOOR_TARGET'];
  const plantsVsHepaCitation = citations['SCI:PLANTS_VS_HEPA'];
  const overBudget = sumActiveHacksCostInr(profile.activeHacks) > profile.monthlyBudgetInr;

  return (
    <>
      <ImpactDashboard report={report} language={language} />
      <AiPlanBriefingCard
        report={report} briefing={briefing} isLoading={isBriefingLoading}
        language={language} hasOverBudgetSelection={overBudget} briefingFailed={briefingFailed}
      />
      <DailyRoutineTimeline
        routine={routine} optimalVentilationWindow={report.exposure.optimalVentilationWindow}
        language={language}
        {...(indoorTargetCitation !== undefined ? { indoorTargetCitation } : {})}
        {...(plantsVsHepaCitation !== undefined ? { plantsVsHepaCitation } : {})}
      />
      <WhatIfComparator profile={profile} liveAq={liveAq} report={householdReport} />
    </>
  );
}

function AppMainResults({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  const { profile, plan, updateRwaHouseholds, updateRwaAdoptionRate } = state;
  const { report, rwaNotice } = plan;
  const hasLocalAq = report.aqStatus !== 'unavailable' && report.aqStatus !== 'pending';
  return (
    <div className="space-y-5 lg:col-span-8">
      {hasLocalAq && <LocalResults state={state} />}
      <RWACommunityPanel
        households={profile.rwaHouseholds ?? 120} adoptionRate={profile.rwaAdoptionRate ?? 0.45}
        emissions={report.emissions} rwaNotice={rwaNotice} language={profile.language}
        onHouseholdsChange={updateRwaHouseholds} onAdoptionChange={updateRwaAdoptionRate}
      />
      <GroundedAssistant
        profile={profile}
        observationId={report.observationId}
        snapshotToken={state.snapshotToken}
        onSyncReport={state.syncExternalReport}
      />
    </div>
  );
}

function AppMainColumns({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <PersonaForm
          profile={state.profile}
          presetSelectionRevision={state.presetSelectionRevision}
          iaqHacks={state.plan.iaqHacks}
          onUpdate={state.updateProfile}
          onToggleHack={state.toggleHack}
          onSelectLocation={state.selectLocation}
          onSelectPresetCity={state.selectPresetCity}
          onApplyScenario={state.applySampleScenario}
        />
      </div>
      <AppMainResults state={state} />
    </div>
  );
}

/** Props for the AuthenticatedWorkspace component. */
export interface AuthenticatedWorkspaceProps {
  readonly authUser: AuthUser;
  readonly onSignOut: () => void;
  readonly signOutFailed?: 'save' | 'logout';
  readonly isSigningOut?: boolean;
  readonly onRegisterPrefsFlush?: (flush: () => Promise<void> | undefined) => void;
}

function AuthenticatedWorkspaceContent({
  authUser,
  onSignOut,
  signOutFailed,
  isSigningOut = false,
  onRegisterPrefsFlush,
}: AuthenticatedWorkspaceProps): React.ReactElement {
  const state = useSmogPlan({
    persona: authUser.personaId, language: authUser.defaultLang, cityId: authUser.defaultCityId,
  });
  const { profile, plan, isSyncing, setLanguage, selectPresetCity, applySampleScenario } = state;
  const hasLocalAq = plan.report.aqStatus !== 'unavailable' && plan.report.aqStatus !== 'pending';
  const { error, recover } = usePreferenceSync(profile, applySampleScenario, onRegisterPrefsFlush);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        city={plan.report.city} language={profile.language} dataSource={plan.report.dataSource}
        isSyncing={isSyncing} aqUnavailable={plan.report.aqStatus === 'unavailable'}
        hasLocalSections={hasLocalAq} isSigningOut={isSigningOut}
        onCityChange={selectPresetCity} onLanguageChange={setLanguage}
        isAuthenticated={true} authUser={authUser} onSignOut={onSignOut}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl space-y-4 px-4 py-5 focus:outline-none"
      >
        <WorkspaceAlerts
          language={profile.language}
          {...(signOutFailed !== undefined ? { signOutFailed } : {})}
          preferenceError={error}
          recoverPreferences={recover}
          isSigningOut={isSigningOut}
        />
        <SmogAlertBanner {...buildBannerProps(state)} />
        <div inert={isSigningOut}>
          <AppMainColumns state={state} />
        </div>
      </main>
      <AppFooter language={profile.language} />
    </div>
  );
}

/** Renders the authenticated SmogWise Virtual workspace with synced preferences. */
export const AuthenticatedWorkspace: React.FC<AuthenticatedWorkspaceProps> = function Workspace(
  props,
) {
  const { authUser } = props;
  return (
    <ErrorBoundary language={authUser.defaultLang} resetKey={authUser.id}>
      <AuthenticatedWorkspaceContent {...props} />
    </ErrorBoundary>
  );
};
