/** Keeps versioned profile saves ordered and exposes explicit conflict recovery. */

import { useCallback, useEffect, useState } from 'react';
import type { UserProfile } from '../domain/types.js';
import { ApiError, fetchUserPreferences, readResponseEtag, saveUserPreferences }
  from '../services/apiClient.js';

/** Categorizes preference failures for the workspace's recovery controls. */
export type SaveErrorKind = 'failed' | 'conflict' | 'load';

type Flush = () => Promise<void> | undefined;

interface SyncState {
  latest: UserProfile;
  readonly initial: UserProfile;
  syncedJson: string;
  etag?: string;
  queue: Promise<void>;
  pending: number;
  error: SaveErrorKind | null;
  timer?: number;
}

function readRequiredEtag(payload: object): string {
  const etag = readResponseEtag(payload);
  if (etag === undefined || !/^"v(?:0|[1-9]\d*)"$/.test(etag)) {
    throw new Error('Missing or invalid preference revision.');
  }
  return etag;
}

function cancelSchedule(state: SyncState): void {
  if (state.timer === undefined) return;
  window.clearTimeout(state.timer);
  delete state.timer;
}

function hasPendingChange(state: SyncState): boolean {
  return JSON.stringify(state.latest) !== state.syncedJson || state.pending > 0;
}

function acceptLoadedProfile(
  state: SyncState,
  saved: UserProfile,
  replaceLocal: boolean,
  applyProfile: (profile: UserProfile) => void,
): void {
  const shouldReplace = replaceLocal || !hasPendingChange(state);
  state.syncedJson = JSON.stringify(saved);
  if (shouldReplace && state.latest !== saved) {
    state.latest = saved;
    applyProfile(saved);
  }
}

function useLoadPreferences(
  state: SyncState,
  applyProfile: (profile: UserProfile) => void,
  setError: (error: SaveErrorKind | null) => void,
  setReady: (ready: boolean) => void,
) {
  return useCallback(async (replaceLocal: boolean, signal?: AbortSignal) => {
    setReady(false);
    try {
      const result = await fetchUserPreferences(signal);
      if (signal?.aborted) return;
      state.etag = readRequiredEtag(result);
      acceptLoadedProfile(state, result.profile ?? state.initial, replaceLocal, applyProfile);
      state.error = null;
      setError(null);
      setReady(true);
    } catch {
      if (signal?.aborted) return;
      state.error = replaceLocal ? 'conflict' : 'load';
      setError(state.error);
    }
  }, [applyProfile, setError, setReady, state]);
}

function useSaveQueue(state: SyncState, setError: (error: SaveErrorKind | null) => void) {
  return useCallback((retry = false): Promise<void> => {
    state.pending += 1;
    const run = state.queue.then(async () => {
      const target = state.latest;
      const json = JSON.stringify(target);
      if (json === state.syncedJson) return;
      if (state.etag === undefined || state.error === 'conflict') {
        throw new Error('The current preference revision must be loaded before saving.');
      }
      if (state.error === 'failed' && !retry) throw new Error('A preference save failed.');
      try {
        const res = await saveUserPreferences(target, undefined, state.etag);
        state.etag = readRequiredEtag(res);
        state.syncedJson = json;
        state.error = null;
        setError(null);
      } catch (err: unknown) {
        state.error = err instanceof ApiError && err.code === 'PREFS_CONFLICT'
          ? 'conflict' : 'failed';
        setError(state.error);
        throw err;
      }
    }).finally(() => { state.pending -= 1; });
    state.queue = run.catch(() => undefined);
    return run;
  }, [setError, state]);
}

/** Hydrates preferences and rejects flushes without a successful save acknowledgment. */
export function usePreferenceSync(
  profile: UserProfile,
  applyProfile: (profile: UserProfile) => void,
  onRegisterFlush?: (flush: Flush) => void,
) {
  const [state] = useState<SyncState>(() => ({
    latest: profile, initial: profile, syncedJson: JSON.stringify(profile),
    queue: Promise.resolve(), pending: 0, error: null,
  }));
  const [error, setError] = useState<SaveErrorKind | null>(null);
  const [ready, setReady] = useState(false);
  const load = useLoadPreferences(state, applyProfile, setError, setReady);
  const save = useSaveQueue(state, setError);

  useEffect(() => {
    const controller = new AbortController();
    void load(false, controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    state.latest = profile;
    if (!ready || error !== null || !hasPendingChange(state)) return undefined;
    state.timer = window.setTimeout(() => {
      delete state.timer;
      void save().catch(() => undefined);
    }, 1000);
    return () => cancelSchedule(state);
  }, [profile, ready, error, save, state]);

  const flushPending = useCallback(() => {
    cancelSchedule(state);
    if (!hasPendingChange(state)) return undefined;
    return save();
  }, [save, state]);

  const recover = useCallback(() => {
    if (error === 'conflict') void load(true);
    if (error === 'load') void load(false);
    if (error === 'failed') void save(true).catch(() => undefined);
  }, [error, load, save]);

  useEffect(() => {
    onRegisterFlush?.(flushPending);
  }, [flushPending, onRegisterFlush]);

  return { error, recover };
}
