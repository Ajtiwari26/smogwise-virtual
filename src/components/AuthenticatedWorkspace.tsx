/**
 * Authenticated main workspace view with race-safe preference synchronization and ErrorBoundary.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../domain/types.js';
import { getAfternoonVentilation } from '../domain/ventilation.js';
import { useSmogPlan, type UseSmogPlanResult } from '../hooks/useSmogPlan.js';
import {
  fetchUserPreferences,
  saveUserPreferences,
  type AuthUser,
} from '../services/apiClient.js';
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

function AppMainResults({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  const { report, routine, rwaNotice, citations } = state.plan;
  const indoorTargetCitation = citations['CALC:INDOOR_TARGET'];
  const plantsVsHepaCitation = citations['SCI:PLANTS_VS_HEPA'];

  return (
    <div className="space-y-5 lg:col-span-8">
      <ImpactDashboard report={report} language={state.profile.language} />
      <AiPlanBriefingCard
        report={report}
        briefing={state.briefing}
        isLoading={state.isBriefingLoading}
        language={state.profile.language}
      />
      <DailyRoutineTimeline
        routine={routine}
        optimalVentilationWindow={report.exposure.optimalVentilationWindow}
        language={state.profile.language}
        {...(indoorTargetCitation !== undefined ? { indoorTargetCitation } : {})}
        {...(plantsVsHepaCitation !== undefined ? { plantsVsHepaCitation } : {})}
      />
      <WhatIfComparator profile={state.profile} liveAq={state.liveAq} />
      <RWACommunityPanel
        households={state.profile.rwaHouseholds ?? 120}
        adoptionRate={state.profile.rwaAdoptionRate ?? 0.45}
        emissions={report.emissions}
        rwaNotice={rwaNotice}
        language={state.profile.language}
        onHouseholdsChange={state.updateRwaHouseholds}
        onAdoptionChange={state.updateRwaAdoptionRate}
      />
      <GroundedAssistant profile={state.profile} />
    </div>
  );
}

function AppMainColumns({ state }: { readonly state: UseSmogPlanResult }): React.ReactElement {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="lg:col-span-4">
        <PersonaForm
          profile={state.profile}
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

function useHydratePreferences(
  profile: UserProfile,
  applySampleScenario: (scenarioProfile: UserProfile) => void,
  lastSyncedJsonRef: React.MutableRefObject<string | null>,
): boolean {
  const [hasHydrated, setHasHydrated] = useState<boolean>(false);
  const initialJsonRef = useRef<string>(JSON.stringify(profile));
  const profileRef = useRef<UserProfile>(profile);
  const editedBeforeHydrationRef = useRef<boolean>(false);

  useEffect(() => {
    profileRef.current = profile;
    if (!hasHydrated && JSON.stringify(profile) !== initialJsonRef.current) {
      editedBeforeHydrationRef.current = true;
    }
  }, [hasHydrated, profile]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetchUserPreferences(controller.signal);
        if (controller.signal.aborted) return;
        if (res.profile !== null && !editedBeforeHydrationRef.current) {
          lastSyncedJsonRef.current = JSON.stringify(res.profile);
          applySampleScenario(res.profile);
        } else {
          lastSyncedJsonRef.current = editedBeforeHydrationRef.current
            ? null
            : JSON.stringify(profileRef.current);
        }
      } catch (err: unknown) {
        void err;
        lastSyncedJsonRef.current ??= JSON.stringify(profileRef.current);
      } finally {
        if (!controller.signal.aborted) {
          setHasHydrated(true);
        }
      }
    })();
    return () => controller.abort();
  }, [applySampleScenario, lastSyncedJsonRef]);

  return hasHydrated;
}

function usePreferenceSync(
  profile: UserProfile,
  applySampleScenario: (scenarioProfile: UserProfile) => void,
): void {
  const lastSyncedJsonRef = useRef<string | null>(null);
  const hasHydrated = useHydratePreferences(profile, applySampleScenario, lastSyncedJsonRef);

  useEffect(() => {
    const serialized = JSON.stringify(profile);
    if (!hasHydrated || serialized === lastSyncedJsonRef.current) {
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void saveUserPreferences(profile, controller.signal)
        .then(() => {
          if (!controller.signal.aborted) {
            lastSyncedJsonRef.current = serialized;
          }
        })
        .catch((err: unknown) => {
          // Best-effort preference persistence; next profile edit retries automatically.
          void err;
        });
    }, 1000);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [hasHydrated, profile]);
}

/** Props for the AuthenticatedWorkspace component. */
export interface AuthenticatedWorkspaceProps {
  readonly authUser: AuthUser;
  readonly onSignOut: () => void;
  readonly signOutFailed?: boolean;
}

/** Renders the authenticated SmogWise Virtual workspace with synced preferences. */
export const AuthenticatedWorkspace: React.FC<AuthenticatedWorkspaceProps> = function Workspace({
  authUser,
  onSignOut,
  signOutFailed,
}) {
  const state = useSmogPlan({
    persona: authUser.personaId,
    language: authUser.defaultLang,
    cityId: authUser.defaultCityId,
  });
  const { profile, plan, isSyncing, setLanguage, selectPresetCity, applySampleScenario } =
    state;
  const { report } = plan;

  usePreferenceSync(profile, applySampleScenario);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        city={report.city}
        language={profile.language}
        dataSource={report.dataSource}
        isSyncing={isSyncing}
        onCityChange={selectPresetCity}
        onLanguageChange={setLanguage}
        isAuthenticated={true}
        authUser={authUser}
        onSignOut={onSignOut}
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-7xl space-y-4 px-4 py-5 focus:outline-none"
      >
        {signOutFailed && (
          <p role="alert" className="rounded border border-red-800 bg-red-50 p-2 text-sm text-red-900">
            {profile.language === 'hi'
              ? 'लॉग आउट नहीं हो सका। फिर से प्रयास करें।'
              : 'Could not sign out. Please try again.'}
          </p>
        )}
        <ErrorBoundary language={profile.language} resetKey={authUser.id}>
          <SmogAlertBanner {...buildBannerProps(state)} />
          <AppMainColumns state={state} />
        </ErrorBoundary>
      </main>

      <AppFooter language={profile.language} />
    </div>
  );
};
