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
import { postPlan, postPlanBriefing } from '../services/apiClient.js';
import {
  BRIEFING_DEBOUNCE_MS,
  buildLocationKey,
  buildRemotePlanOutput,
  buildTrackedLocRef,
  DEBOUNCE_MS,
  readActiveLoc,
  resolveAqErrorCode,
  type SettledBriefingState,
  type SettledPlanState,
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

interface SyncTarget {
  readonly locationKey: string;
  readonly revision: number;
}

function isTargetCurrent(target: SyncTarget, locationKey: string, revision: number): boolean {
  return target.locationKey === locationKey && target.revision === revision;
}

function scheduleBriefingSync(
  profile: UserProfile,
  revision: number,
  startedAt: number,
  token: string | undefined,
  controller: AbortController,
  latestTargetRef: React.RefObject<SyncTarget>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): ReturnType<typeof setTimeout> {
  const gap = BRIEFING_DEBOUNCE_MS - DEBOUNCE_MS - (Date.now() - startedAt);
  const locationKey = buildLocationKey(profile);
  return setTimeout(() => {
    void postPlanBriefing(profile, controller.signal, token).then(
      (b) => {
        const cur = isTargetCurrent(latestTargetRef.current, locationKey, revision);
        if (!controller.signal.aborted && cur) setBriefingState({ profile, revision, data: b });
      },
      (err: unknown) => {
        const cur = isTargetCurrent(latestTargetRef.current, locationKey, revision);
        if (!controller.signal.aborted && cur) setBriefingState({ profile, revision, error: err });
      },
    );
  }, Math.max(0, gap));
}

function applySettledPlan(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  data: FullPlanOutput,
  tokenForPlan: string | undefined,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
): string | undefined {
  const activeLoc = readActiveLoc(locRef.current, locationKey, revision);
  const ok = shouldAcceptExternalSnapshot(
    activeLoc, data.report, data.snapshotToken, tokenForPlan, true,
  );
  if (!ok) return activeLoc?.token;
  const nextToken = data.snapshotToken ?? tokenForPlan;
  locRef.current = buildTrackedLocRef(locationKey, revision, data.report, nextToken);
  const resolved = nextToken === undefined || data.snapshotToken !== undefined
    ? data : { ...data, snapshotToken: nextToken };
  setSettledPlan({ profile, revision, locationKey, data: resolved });
  return nextToken;
}

function scheduleCoordinatedSync(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  latestTargetRef: React.RefObject<SyncTarget>,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): () => void {
  const controller = new AbortController();
  const cached = readActiveLoc(locRef.current, locationKey, revision);
  if (cached?.errorCode === 'LIVE_AQ_UNAVAILABLE') return () => controller.abort();
  let briefingTimer: ReturnType<typeof setTimeout> | undefined;
  const planTimer = setTimeout(() => {
    const tokenForPlan = readActiveLoc(locRef.current, locationKey, revision)?.token;
    const startedAt = Date.now();
    void postPlan(profile, controller.signal, tokenForPlan).then(
      (data) => {
        if (controller.signal.aborted) return;
        if (!isTargetCurrent(latestTargetRef.current, locationKey, revision)) return;
        const nextToken = applySettledPlan(
          profile, revision, locationKey, data, tokenForPlan, locRef, setSettledPlan,
        );
        briefingTimer = scheduleBriefingSync(
          profile, revision, startedAt, nextToken, controller, latestTargetRef, setBriefingState,
        );
      },
      (error: unknown) => {
        const cur = isTargetCurrent(latestTargetRef.current, locationKey, revision);
        if (!controller.signal.aborted && cur) {
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

function setTokenIfPresent(
  prev: SettledPlanState | undefined,
  token: string,
): SettledPlanState | undefined {
  if (prev?.data === undefined) return prev;
  return { ...prev, data: { ...prev.data, snapshotToken: token } };
}

function applyExternalSnapshot(
  profile: UserProfile, revision: number, locationKey: string,
  latestTargetRef: React.RefObject<SyncTarget>,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  report: DeterministicReport, token?: string, requestedToken?: string,
): void {
  if (!isTargetCurrent(latestTargetRef.current, locationKey, revision)) return;
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
  const latestTargetRef = useRef<SyncTarget>({ locationKey, revision });
  latestTargetRef.current = { locationKey, revision };

  useEffect(
    () => scheduleCoordinatedSync(
      profile, revision, locationKey, latestTargetRef, locRef, setSettledPlan, setBriefingState,
    ),
    [locationKey, profile, revision],
  );

  const syncExternalReport = useCallback(
    (report: DeterministicReport, token?: string, requestedToken?: string) =>
      applyExternalSnapshot(
        profile, revision, locationKey, latestTargetRef, locRef,
        setSettledPlan, report, token, requestedToken,
      ),
    [locationKey, profile, revision],
  );

  return {
    ...buildRemotePlanOutput(profile, revision, locationKey, settledPlan, briefingState),
    syncExternalReport,
  };
}
