/**
 * Grounded Tier 2 GenAI Q&A panel calling /api/ai/ask with race-safe abort handling
 * and bilingual accessible validation.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isPlainRecord } from '../domain/domainUtils.js';
import type { UserProfile } from '../domain/types.js';
import type { AiAskApiResponse } from '../services/apiClient.js';
import { postAiAsk } from '../services/apiClient.js';
import {
  AssistantAnswerCard,
  type AssistantErrorCode,
  AssistantForm,
  formatAssistantError,
  QuickPromptsBar,
} from './GroundedAssistantParts.js';

/** Props for the GroundedAssistant component. */
export interface GroundedAssistantProps {
  readonly profile: UserProfile;
}

function dispatchAssistantAsk(
  trimmed: string,
  profile: UserProfile,
  abortRef: React.MutableRefObject<AbortController | null>,
  setResponse: React.Dispatch<React.SetStateAction<AiAskApiResponse | undefined>>,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setErrorCode: React.Dispatch<React.SetStateAction<AssistantErrorCode | null>>,
): void {
  abortRef.current?.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  setIsLoading(true);
  setErrorCode(null);

  void postAiAsk(trimmed, profile, controller.signal)
    .then((res) => {
      if (!controller.signal.aborted) {
        setResponse(res);
        setIsLoading(false);
      }
    })
    .catch((err: unknown) => {
      void err;
      if (!controller.signal.aborted) {
        setErrorCode('ASK_FAILED');
        setIsLoading(false);
      }
    });
}

function useAssistantController(profile: UserProfile) {
  const [question, setQuestion] = useState<string>('');
  const [response, setResponse] = useState<AiAskApiResponse | undefined>(undefined);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorCode, setErrorCode] = useState<AssistantErrorCode | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const questionRef = useRef<string>(question);

  useEffect(() => {
    questionRef.current = question;
  }, [question]);

  const abortPendingAsk = useCallback(() => abortRef.current?.abort(), []);
  const profileKey = JSON.stringify(profile, (_key, value: unknown): unknown => {
    if (!isPlainRecord(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
  });
  useLayoutEffect(() => {
    setQuestion('');
    setResponse(undefined);
    setIsLoading(false);
    setErrorCode(null);
    return abortPendingAsk;
  }, [abortPendingAsk, profileKey]);

  const submitQuestion = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        setErrorCode('EMPTY_QUESTION');
        return;
      }
      dispatchAssistantAsk(trimmed, profile, abortRef, setResponse, setIsLoading, setErrorCode);
    },
    [profile],
  );

  const handleQuickSelect = useCallback(
    (label: string) => {
      setQuestion(label);
      submitQuestion(label);
    },
    [submitQuestion],
  );
  const handleQuestionChange = useCallback((val: string) => {
    setQuestion(val);
    setErrorCode((prev) => (prev === 'EMPTY_QUESTION' ? null : prev));
  }, []);
  const handleFormSubmit = useCallback(() => submitQuestion(questionRef.current), [submitQuestion]);

  return {
    question,
    response,
    isLoading,
    errorCode,
    handleQuickSelect,
    handleQuestionChange,
    handleFormSubmit,
  };
}

/** Grounded Tier 2 GenAI Q&A panel calling /api/ai/ask with citation pills. */
export const GroundedAssistant: React.FC<GroundedAssistantProps> = React.memo(
  function GroundedAssistant({ profile }) {
    const isHi = profile.language === 'hi';
    const {
      question,
      response,
      isLoading,
      errorCode,
      handleQuickSelect,
      handleQuestionChange,
      handleFormSubmit,
    } = useAssistantController(profile);
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
