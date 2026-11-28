/**
 * Pure helpers, constants, and race-safe debounced sync effects for useSmogPlan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeFullPlan, extractReportLiveAq } from '../domain/impactService.js';
import type {
  DeterministicReport,
  FullPlanOutput,
  UserProfile,
} from '../domain/types.js';
import {
  type PlanBriefingApiResponse,
  postPlan,
  postPlanBriefing,
} from '../services/apiClient.js';
import {
  type AqErrorCode,
  BRIEFING_DEBOUNCE_MS,
  buildLocationKey,
  buildTrackedLocRef,
  DEBOUNCE_MS,
  readActiveLoc,
  readAqMetaFromReport,
  resolveAqErrorCode,
  shouldAcceptExternalSnapshot,
  type TrackedSnapshotMeta,
} from './useSmogPlanMetadata.js';

/** Re-exported AQ metadata constants and location helpers for hook consumers. */
export {
  type AqErrorCode,
  type AqMeta,
  BRIEFING_DEBOUNCE_MS,
  buildCustomLocation,
  DEBOUNCE_MS,
  DEFAULT_RWA_ADOPTION_RATE,
  DEFAULT_RWA_HOUSEHOLDS,
  formatAqErrorCode,
  stripCustomLocation,
} from './useSmogPlanMetadata.js';

interface SettledPlanState {
  readonly profile: UserProfile;
  readonly revision: number;
  readonly locationKey: string;
  readonly data?: FullPlanOutput;
  readonly errorCode?: AqErrorCode;
}

interface SettledBriefingState {
  readonly profile: UserProfile;
  readonly revision: number;
  readonly data?: PlanBriefingApiResponse;
  readonly error?: unknown;
}

type SettledLocRef = TrackedSnapshotMeta & {
  readonly key: string;
  readonly revision: number;
};

/** Memoizes household-only inputs for calculations and requests unaffected by RWA controls. */
export function useHouseholdProfile(profile: UserProfile): UserProfile {
  const {
    persona, cityId, language, householdSize, hasVulnerableMember, monthlyBudgetInr,
    roomVolumeM3, commuteMode, commuteDistanceKm, cookingFuel, activeHacks, customLocation,
  } = profile;
  return useMemo(() => ({
    persona, cityId, language, householdSize, hasVulnerableMember, monthlyBudgetInr,
    roomVolumeM3, commuteMode, commuteDistanceKm, cookingFuel, activeHacks,
    ...(customLocation !== undefined ? { customLocation } : {}),
  }), [
    persona, cityId, language, householdSize, hasVulnerableMember, monthlyBudgetInr,
    roomVolumeM3, commuteMode, commuteDistanceKm, cookingFuel, activeHacks, customLocation,
  ]);
}

function handleSyncFailure(
  error: unknown,
  profile: UserProfile,
  revision: number,
  locationKey: string,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): void {
  const errorCode = resolveAqErrorCode(error);
  const keepValid = errorCode !== 'LIVE_AQ_UNAVAILABLE' &&
    locRef.current?.key === locationKey && locRef.current.revision === revision;
  locRef.current = keepValid && locRef.current?.token !== undefined
    ? { ...locRef.current, errorCode }
    : { key: locationKey, revision, errorCode };
  setSettledPlan((prev) => {
    const canKeep = keepValid && prev?.locationKey === locationKey &&
      prev.revision === revision && prev.data !== undefined;
    return canKeep
      ? { ...prev, errorCode }
      : { profile, revision, locationKey, errorCode };
  });
  setBriefingState({ profile, revision, error });
}

function scheduleCoordinatedSync(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): () => void {
  const controller = new AbortController();
  const cached = locRef.current?.key === locationKey && locRef.current.revision === revision
    ? locRef.current : undefined;
  if (cached?.errorCode === 'LIVE_AQ_UNAVAILABLE') return () => controller.abort();
  const tokenForPlan = cached?.token;
  let briefingTimer: ReturnType<typeof setTimeout> | undefined;
  const planTimer = setTimeout(() => {
    const startedAt = Date.now();
    void postPlan(profile, controller.signal, tokenForPlan).then(
      (data) => {
        if (controller.signal.aborted) return;
        const nextToken = data.snapshotToken ?? tokenForPlan;
        locRef.current = {
          key: locationKey, revision,
          ...(data.report.observationId !== undefined
            ? { observationId: data.report.observationId } : {}),
          ...(data.report.observedAt !== undefined ? { observedAt: data.report.observedAt } : {}),
          ...(nextToken !== undefined ? { token: nextToken } : {}),
        };
        setSettledPlan({ profile, revision, locationKey, data });
        const gap = BRIEFING_DEBOUNCE_MS - DEBOUNCE_MS - (Date.now() - startedAt);
        briefingTimer = setTimeout(() => {
          void postPlanBriefing(profile, controller.signal, nextToken).then(
            (b) => {
              if (!controller.signal.aborted) setBriefingState({ profile, revision, data: b });
            },
            (err: unknown) => {
              if (!controller.signal.aborted) setBriefingState({ profile, revision, error: err });
            },
          );
        }, Math.max(0, gap));
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          handleSyncFailure(
            error, profile, revision, locationKey, locRef, setSettledPlan, setBriefingState,
          );
        }
      },
    );
  }, DEBOUNCE_MS);
  return () => {
    clearTimeout(planTimer);
    if (briefingTimer !== undefined) clearTimeout(briefingTimer);
    controller.abort();
  };
}

function readSettledLiveAq(plan: FullPlanOutput | undefined) {
  if (plan === undefined || plan.report.aqStatus === 'unavailable') return undefined;
  return extractReportLiveAq(plan.report);
}

function readPlanFields(
  activeLocPlan: SettledPlanState | undefined,
  profile: UserProfile,
) {
  const data = activeLocPlan?.data;
  return {
    liveAq: readSettledLiveAq(data),
    aqMeta: readAqMetaFromReport(data?.report),
    snapshotToken: data?.snapshotToken,
    aqiErrorCode: activeLocPlan?.errorCode,
    isAqSyncing: activeLocPlan === undefined,
    syncedPlan: activeLocPlan?.profile === profile ? data : undefined,
  };
}

function readBriefingFields(activeBriefing: SettledBriefingState | undefined) {
  return {
    briefing: activeBriefing?.data,
    isBriefingLoading: activeBriefing === undefined,
    briefingError: activeBriefing?.error !== undefined,
  };
}

function buildRemotePlanOutput(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  settledPlan: SettledPlanState | undefined,
  briefingState: SettledBriefingState | undefined,
) {
  const activeLocPlan =
    settledPlan !== undefined &&
    settledPlan.locationKey === locationKey &&
    settledPlan.revision === revision
      ? settledPlan : undefined;
  const activeBriefing =
    briefingState !== undefined &&
    briefingState.profile === profile &&
    briefingState.revision === revision
      ? briefingState : undefined;
  return {
    ...readPlanFields(activeLocPlan, profile),
    ...readBriefingFields(activeBriefing),
  };
}

function setTokenIfPresent(
  prev: SettledPlanState | undefined,
  token: string,
): SettledPlanState | undefined {
  if (prev?.data === undefined) return prev;
  return { ...prev, data: { ...prev.data, snapshotToken: token } };
}

function applyExternalSnapshot(
  profile: UserProfile, revision: number, locationKey: string,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  report: DeterministicReport, token?: string, requestedToken?: string,
): void {
  const activeLoc = readActiveLoc(locRef.current, locationKey, revision);
  if (!shouldAcceptExternalSnapshot(activeLoc, report, token, requestedToken)) return;
  locRef.current = buildTrackedLocRef(locationKey, revision, report, token);
  if (report.observationId !== undefined && activeLoc?.observationId === report.observationId) {
    if (token !== undefined) setSettledPlan((prev) => setTokenIfPresent(prev, token));
    return;
  }
  const plan = computeFullPlan(profile, extractReportLiveAq(report));
  setSettledPlan({
    profile, revision, locationKey,
    data: token === undefined ? plan : { ...plan, snapshotToken: token },
  });
}

/** Queries coordinated /api/plan and /api/plan/briefing with shared snapshot identity. */
export function useRemotePlan(profile: UserProfile, revision: number) {
  const locationKey = buildLocationKey(profile);
  const [settledPlan, setSettledPlan] = useState<SettledPlanState>();
  const [briefingState, setBriefingState] = useState<SettledBriefingState>();
  const locRef = useRef<SettledLocRef | undefined>(undefined);

  useEffect(
    () => scheduleCoordinatedSync(
      profile, revision, locationKey, locRef, setSettledPlan, setBriefingState,
    ),
    [locationKey, profile, revision],
  );

  const syncExternalReport = useCallback(
    (report: DeterministicReport, token?: string, requestedToken?: string) =>
      applyExternalSnapshot(
        profile, revision, locationKey, locRef, setSettledPlan, report, token, requestedToken,
      ),
    [locationKey, profile, revision],
  );

  return {
    ...buildRemotePlanOutput(profile, revision, locationKey, settledPlan, briefingState),
    syncExternalReport,
  };
}
