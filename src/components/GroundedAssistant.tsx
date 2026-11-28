/**
 * Grounded Tier 2 GenAI Q&A panel calling /api/ai/ask with race-safe abort handling
 * and bilingual accessible validation.
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { DeterministicReport, UserProfile } from '../domain/types.js';
import type { AiAskApiResponse } from '../services/apiClient.js';
import { ApiError, postAiAsk } from '../services/apiClient.js';
import {
  AssistantAnswerCard,
  type AssistantErrorCode,
  AssistantForm,
  formatAssistantError,
  QuickPromptsBar,
} from './GroundedAssistantParts.js';

type SyncReportFn = (
  report: DeterministicReport,
  token?: string,
  requestedToken?: string,
) => void;

interface SyncMeta {
  readonly obs: string | undefined;
  readonly token: string | undefined;
  readonly rev: number;
}

/** Props for the GroundedAssistant component. */
export interface GroundedAssistantProps {
  readonly profile: UserProfile;
  readonly selectionRevision?: number | undefined;
  readonly observationId?: string | undefined;
  readonly snapshotToken?: string | undefined;
  readonly onSyncReport?: SyncReportFn | undefined;
}

function dispatchAssistantAsk(
  trimmed: string,
  profile: UserProfile,
  syncMetaRef: React.RefObject<SyncMeta>,
  snapshotToken: string | undefined,
  onSyncReport: SyncReportFn | undefined,
  abortRef: React.MutableRefObject<AbortController | null>,
  setResponse: React.Dispatch<React.SetStateAction<AiAskApiResponse | undefined>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setErrorCode: React.Dispatch<React.SetStateAction<AssistantErrorCode | null>>,
): void {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  const sentRev = syncMetaRef.current.rev;
  setIsLoading(true);
  setErrorCode(null);

  void postAiAsk(trimmed, profile, controller.signal, snapshotToken)
    .then((res) => {
      if (controller.signal.aborted || syncMetaRef.current.rev !== sentRev) return;
      const obsChanged = res.report.observationId !== syncMetaRef.current.obs;
      const tokenRenewed =
        res.snapshotToken !== undefined && res.snapshotToken !== syncMetaRef.current.token;
      if (res.mode !== 'guard_refusal' && (obsChanged || tokenRenewed)) {
        onSyncReport?.(res.report, res.snapshotToken, snapshotToken);
      }
      setResponse(res);
      setIsLoading(false);
    })
    .catch((err: unknown) => {
      if (!controller.signal.aborted && syncMetaRef.current.rev === sentRev) {
        const unavailable = err instanceof ApiError && err.code === 'LIVE_AQ_UNAVAILABLE';
        setErrorCode(unavailable ? 'AQ_UNAVAILABLE' : 'ASK_FAILED');
        setIsLoading(false);
      }
    });
}

function buildAssistantProfileKey(profile: UserProfile): string {
  return JSON.stringify([
    profile.persona,
    profile.cityId,
    profile.language,
    profile.householdSize,
    profile.hasVulnerableMember,
    profile.monthlyBudgetInr,
    profile.roomVolumeM3,
    profile.commuteMode,
    profile.commuteDistanceKm,
    profile.cookingFuel,
    profile.rwaHouseholds,
    profile.rwaAdoptionRate,
    profile.customLocation?.name,
    profile.customLocation?.state,
    profile.customLocation?.lat,
    profile.customLocation?.lon,
    [...profile.activeHacks].sort().join(','),
  ]);
}

function useSyncMetaRef(
  observationId: string | undefined,
  snapshotToken: string | undefined,
  selectionRevision: number,
): React.RefObject<SyncMeta> {
  const ref = useRef<SyncMeta>({
    obs: observationId, token: snapshotToken, rev: selectionRevision,
  });
  useLayoutEffect(() => {
    ref.current = { obs: observationId, token: snapshotToken, rev: selectionRevision };
  }, [observationId, selectionRevision, snapshotToken]);
  return ref;
}

function useAssistantController(
  profile: UserProfile,
  selectionRevision: number,
  observationId?: string,
  snapshotToken?: string,
  onSyncReport?: SyncReportFn,
) {
  const [question, setQuestion] = useState<string>('');
  const [response, setResponse] = useState<AiAskApiResponse | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorCode, setErrorCode] = useState<AssistantErrorCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const questionRef = useRef<string>(question);
  const syncMetaRef = useSyncMetaRef(observationId, snapshotToken, selectionRevision);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  const abortPendingAsk = useCallback(() => abortRef.current?.abort(), []);
  const profileKey = useMemo(() => buildAssistantProfileKey(profile), [profile]);
  useLayoutEffect(() => {
    setQuestion('');
    setResponse(undefined);
    setIsLoading(false);
    setErrorCode(null);
    return abortPendingAsk;
  }, [abortPendingAsk, profileKey, selectionRevision]);

  const submitQuestion = useCallback((text: string): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      setErrorCode('EMPTY_QUESTION');
      return;
    }
    dispatchAssistantAsk(
      trimmed, profile, syncMetaRef, snapshotToken, onSyncReport,
      abortRef, setResponse, setIsLoading, setErrorCode,
    );
  }, [onSyncReport, profile, snapshotToken, syncMetaRef]);
  const handleQuickSelect = useCallback((label: string) => {
    setQuestion(label);
    submitQuestion(label);
  }, [submitQuestion]);
  const handleQuestionChange = useCallback((val: string) => {
    setQuestion(val);
    setErrorCode((prev) => (prev === 'EMPTY_QUESTION' ? null : prev));
  }, []);
  const handleFormSubmit = useCallback(() => submitQuestion(questionRef.current), [submitQuestion]);
  return {
    question, response, isLoading, errorCode,
    handleQuickSelect, handleQuestionChange, handleFormSubmit,
  };
}

/** Grounded Tier 2 GenAI Q&A panel calling /api/ai/ask with citation pills. */
export const GroundedAssistant: React.FC<GroundedAssistantProps> = React.memo(
  function GroundedAssistant({
    profile, selectionRevision = 0, observationId, snapshotToken, onSyncReport,
  }) {
    const isHi = profile.language === 'hi';
    const {
      question,
      response,
      isLoading,
      errorCode,
      handleQuickSelect,
      handleQuestionChange,
      handleFormSubmit,
    } = useAssistantController(
      profile, selectionRevision, observationId, snapshotToken, onSyncReport,
    );
    const errorMsg = formatAssistantError(errorCode, isHi);

    return (
      <section
        id="assistant"
        aria-labelledby="assistant-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <h2 id="assistant-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'सत्यापित स्मॉग सहायक (Grounded AI)' : 'Grounded Smog Assistant'}
        </h2>
        <QuickPromptsBar isHi={isHi} onSelect={handleQuickSelect} />
        <AssistantForm
          question={question}
          isHi={isHi}
          isLoading={isLoading}
          hasError={errorCode !== null}
          isFieldInvalid={errorCode === 'EMPTY_QUESTION'}
          onQuestionChange={handleQuestionChange}
          onSubmit={handleFormSubmit}
        />
        <div aria-live="polite" className="mt-3">
          {errorMsg.length > 0 && (
            <p id="assistant-error" role="alert" className="mb-2 text-xs font-semibold text-red-800">
              {errorMsg}
            </p>
          )}
          {response !== undefined && <AssistantAnswerCard response={response} isHi={isHi} />}
        </div>
      </section>
    );
  },
);
