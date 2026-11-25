import React, { useEffect, useRef, useState } from 'react';
import type { UserProfile } from '../domain/types.js';
import type { AiAskApiResponse } from '../services/apiClient.js';
import { postAiAsk } from '../services/apiClient.js';

/** Props for the GroundedAssistant component. */
export interface GroundedAssistantProps {
  readonly profile: UserProfile;
}

const QUICK_PROMPTS = [
  {
    en: 'When is the safest time to ventilate today?',
    hi: 'आज घर में वेंटिलेशन के लिए सबसे सुरक्षित समय क्या है?',
  },
  {
    en: 'How can I cut indoor PM2.5 under ₹500/month?',
    hi: '₹500/माह से कम में घर का PM2.5 कैसे घटाएं?',
  },
  {
    en: 'Summarize our family smog protection plan.',
    hi: 'हमारे परिवार की स्मॉग सुरक्षा योजना का सारांश दें।',
  },
] as const;

interface QuickPromptsBarProps {
  readonly isHi: boolean;
  readonly onSelect: (prompt: string) => void;
}

const QuickPromptsBar: React.FC<QuickPromptsBarProps> = React.memo(
  function QuickPromptsBar({ isHi, onSelect }) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        {QUICK_PROMPTS.map((item) => {
          const label = isHi ? item.hi : item.en;
          return (
            <button
              key={item.en}
              type="button"
              onClick={() => onSelect(label)}
              className="rounded-full border border-slate-400 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  },
);

const AssistantAnswerCard: React.FC<{ readonly response: AiAskApiResponse }> = React.memo(
  function AssistantAnswerCard({ response }) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="rounded bg-slate-900 px-2 py-0.5 text-white">{response.mode}</span>
          {response.guardTriggered && (
            <span className="rounded bg-red-900 px-2 py-0.5 text-white">Guard Active</span>
          )}
        </div>
        <p className="text-sm text-slate-900">{response.answer}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {response.citationsUsed.map((cite) => (
            <span
              key={cite}
              className="rounded border border-teal-800 bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-900"
            >
              [{cite}]
            </span>
          ))}
        </div>
      </div>
    );
  },
);

function getSubmitLabel(isLoading: boolean, isHi: boolean): string {
  if (isLoading) {
    return isHi ? 'प्रतीक्षा...' : 'Thinking...';
  }
  return isHi ? 'पूछें' : 'Ask';
}

const AssistantForm: React.FC<{
  readonly question: string;
  readonly isHi: boolean;
  readonly isLoading: boolean;
  readonly onQuestionChange: (val: string) => void;
  readonly onSubmit: () => void;
}> = React.memo(function AssistantForm({
  question,
  isHi,
  isLoading,
  onQuestionChange,
  onSubmit,
}) {
  const placeholderText = isHi
    ? 'स्मॉग, वेंटिलेशन या बजट के बारे में पूछें...'
    : 'Ask about smog, ventilation, or budget...';

  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="assistant-input" className="sr-only">
        {isHi ? 'अपना प्रश्न पूछें' : 'Ask a smog safety question'}
      </label>
      <input
        id="assistant-input"
        type="text"
        value={question}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder={placeholderText}
        className="flex-1 rounded-md border border-slate-400 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
      />
      <button
        type="submit"
        disabled={isLoading}
        className="rounded-md bg-teal-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-teal-700"
      >
        {getSubmitLabel(isLoading, isHi)}
      </button>
    </form>
  );
});

/** Grounded Tier 2 GenAI Q&A panel calling /api/ai/ask with citation pills. */
export const GroundedAssistant: React.FC<GroundedAssistantProps> = React.memo(
  function GroundedAssistant({ profile }) {
    const isHi = profile.language === 'hi';
    const [question, setQuestion] = useState<string>('');
    const [response, setResponse] = useState<AiAskApiResponse | undefined>(undefined);
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [errorMsg, setErrorMsg] = useState<string>('');
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => () => abortRef.current?.abort(), []);

    const submitQuestion = (text: string): void => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setErrorMsg('');

      void postAiAsk(trimmed, profile, controller.signal)
        .then((res) => {
          setResponse(res);
          setIsLoading(false);
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }
          setErrorMsg(
            isHi
              ? 'सहायक से उत्तर नहीं मिल सका। कृपया पुनः प्रयास करें।'
              : 'Could not reach the assistant. Please try again.',
          );
          setIsLoading(false);
        });
    };

    return (
      <section
        id="assistant"
        aria-labelledby="assistant-heading"
        className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm"
      >
        <h2 id="assistant-heading" className="text-base font-bold text-slate-900">
          {isHi ? 'सत्यापित स्मॉग सहायक (Grounded AI)' : 'Grounded Smog Assistant'}
        </h2>
        <QuickPromptsBar
          isHi={isHi}
          onSelect={(label) => {
            setQuestion(label);
            submitQuestion(label);
          }}
        />
        <AssistantForm
          question={question}
          isHi={isHi}
          isLoading={isLoading}
          onQuestionChange={setQuestion}
          onSubmit={() => submitQuestion(question)}
        />
        <div aria-live="polite" className="mt-3">
          {errorMsg.length > 0 && (
            <p className="text-xs font-semibold text-red-800">{errorMsg}</p>
          )}
          {response !== undefined && <AssistantAnswerCard response={response} />}
        </div>
      </section>
    );
  },
);
