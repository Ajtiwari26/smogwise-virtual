/**
 * Pure helpers, constants, and race-safe debounced sync effects for useSmogPlan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { computeFullPlan, extractReportLiveAq } from '../domain/impactService.js';
import type { DeterministicReport, FullPlanOutput, UserProfile } from '../domain/types.js';
import { postPlan, postPlanBriefing } from '../services/apiClient.js';
import {
  BRIEFING_DEBOUNCE_MS,
  buildLocationKey,
  buildRemotePlanOutput,
  buildTrackedLocRef,
  DEBOUNCE_MS,
  isTargetCurrent,
  readActiveLoc,
  resolveAqErrorCode,
  setTokenIfPresent,
  type SettledBriefingState,
  type SettledPlanState,
  shouldAcceptExternalSnapshot,
  type SyncTarget,
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
  tokenForPlan: string | undefined,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): void {
  const activeLoc = readActiveLoc(locRef.current, locationKey, revision);
  if (activeLoc?.token !== undefined && tokenForPlan !== activeLoc.token) return;
  const errorCode = resolveAqErrorCode(error);
  const keepValid = errorCode !== 'LIVE_AQ_UNAVAILABLE' && activeLoc !== undefined;
  locRef.current = keepValid && activeLoc.token !== undefined
    ? { ...activeLoc, errorCode }
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

interface BriefingTask {
  readonly controller: AbortController;
  timer?: ReturnType<typeof setTimeout>;
}

interface BriefingDispatch {
  readonly profile: UserProfile;
  readonly revision: number;
  readonly locationKey: string;
  readonly delayMs: number;
  readonly latestTargetRef: React.RefObject<SyncTarget>;
  readonly locRef: React.MutableRefObject<SettledLocRef | undefined>;
  readonly taskRef: React.MutableRefObject<BriefingTask | null>;
  readonly setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>;
}

function cancelBriefingTask(taskRef: React.MutableRefObject<BriefingTask | null>): void {
  const task = taskRef.current;
  if (task === null) return;
  if (task.timer !== undefined) clearTimeout(task.timer);
  task.controller.abort();
  taskRef.current = null;
}

function startBriefingTask(cfg: BriefingDispatch): void {
  cancelBriefingTask(cfg.taskRef);
  const controller = new AbortController();
  const task: BriefingTask = { controller };
  cfg.taskRef.current = task;
  task.timer = setTimeout(() => {
    const token = readActiveLoc(cfg.locRef.current, cfg.locationKey, cfg.revision)?.token;
    void postPlanBriefing(cfg.profile, controller.signal, token).then(
      (b) => {
        const cur = isTargetCurrent(cfg.latestTargetRef.current, cfg.locationKey, cfg.revision);
        if (!controller.signal.aborted && cur) {
          cfg.setBriefingState({ profile: cfg.profile, revision: cfg.revision, data: b });
        }
      },
      (err: unknown) => {
        const cur = isTargetCurrent(cfg.latestTargetRef.current, cfg.locationKey, cfg.revision);
        if (!controller.signal.aborted && cur) {
          cfg.setBriefingState({ profile: cfg.profile, revision: cfg.revision, error: err });
        }
      },
    );
  }, Math.max(0, cfg.delayMs));
}

function applySettledPlan(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  data: FullPlanOutput,
  tokenForPlan: string | undefined,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
): boolean {
  const activeLoc = readActiveLoc(locRef.current, locationKey, revision);
  const ok = shouldAcceptExternalSnapshot(
    activeLoc, data.report, data.snapshotToken, tokenForPlan, true,
  );
  if (!ok) return false;
  const nextToken = data.snapshotToken ?? tokenForPlan;
  locRef.current = buildTrackedLocRef(locationKey, revision, data.report, nextToken);
  const resolved = nextToken === undefined || data.snapshotToken !== undefined
    ? data : { ...data, snapshotToken: nextToken };
  setSettledPlan({ profile, revision, locationKey, data: resolved });
  return true;
}

function schedulePlanSync(
  profile: UserProfile,
  revision: number,
  locationKey: string,
  latestTargetRef: React.RefObject<SyncTarget>,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  taskRef: React.MutableRefObject<BriefingTask | null>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
): () => void {
  const controller = new AbortController();
  const cached = readActiveLoc(locRef.current, locationKey, revision);
  if (cached?.errorCode === 'LIVE_AQ_UNAVAILABLE') return () => controller.abort();
  const planTimer = setTimeout(() => {
    const tokenForPlan = readActiveLoc(locRef.current, locationKey, revision)?.token;
    const startedAt = Date.now();
    void postPlan(profile, controller.signal, tokenForPlan).then(
      (data) => {
        const cur = isTargetCurrent(latestTargetRef.current, locationKey, revision);
        if (controller.signal.aborted || !cur) return;
        if (!applySettledPlan(
          profile, revision, locationKey, data, tokenForPlan, locRef, setSettledPlan,
        )) return;
        startBriefingTask({
          profile, revision, locationKey,
          delayMs: BRIEFING_DEBOUNCE_MS - DEBOUNCE_MS - (Date.now() - startedAt),
          latestTargetRef, locRef, taskRef, setBriefingState,
        });
      },
      (error: unknown) => {
        const cur = isTargetCurrent(latestTargetRef.current, locationKey, revision);
        if (!controller.signal.aborted && cur) {
          handleSyncFailure(
            error, profile, revision, locationKey, tokenForPlan,
            locRef, setSettledPlan, setBriefingState,
          );
        }
      },
    );
  }, DEBOUNCE_MS);
  return () => {
    clearTimeout(planTimer);
    cancelBriefingTask(taskRef);
    controller.abort();
  };
}

function applyExternalSnapshot(
  profile: UserProfile, revision: number, locationKey: string,
  latestTargetRef: React.RefObject<SyncTarget>,
  locRef: React.MutableRefObject<SettledLocRef | undefined>,
  taskRef: React.MutableRefObject<BriefingTask | null>,
  setSettledPlan: React.Dispatch<React.SetStateAction<SettledPlanState | undefined>>,
  setBriefingState: React.Dispatch<React.SetStateAction<SettledBriefingState | undefined>>,
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
  setBriefingState(undefined);
  startBriefingTask({
    profile, revision, locationKey, delayMs: Math.max(0, BRIEFING_DEBOUNCE_MS - DEBOUNCE_MS),
    latestTargetRef, locRef, taskRef, setBriefingState,
  });
}

/** Queries coordinated /api/plan and /api/plan/briefing with shared snapshot identity. */
export function useRemotePlan(profile: UserProfile, revision: number) {
  const locationKey = buildLocationKey(profile);
  const [settledPlan, setSettledPlan] = useState<SettledPlanState>();
  const [briefingState, setBriefingState] = useState<SettledBriefingState>();
  const locRef = useRef<SettledLocRef | undefined>(undefined);
  const briefingTaskRef = useRef<BriefingTask | null>(null);
  const latestTargetRef = useRef<SyncTarget>({ locationKey, revision });
  latestTargetRef.current = { locationKey, revision };

  useEffect(
    () => schedulePlanSync(
      profile, revision, locationKey, latestTargetRef, locRef,
      briefingTaskRef, setSettledPlan, setBriefingState,
    ),
    [locationKey, profile, revision],
  );

  const syncExternalReport = useCallback(
    (report: DeterministicReport, token?: string, requestedToken?: string) =>
      applyExternalSnapshot(
        profile, revision, locationKey, latestTargetRef, locRef,
        briefingTaskRef, setSettledPlan, setBriefingState, report, token, requestedToken,
      ),
    [locationKey, profile, revision],
  );

  return {
    ...buildRemotePlanOutput(profile, revision, locationKey, settledPlan, briefingState),
    syncExternalReport,
  };
}
