/**
 * Presentational sub-components and EN/HI formatting helpers for GroundedAssistant.
 */

import React from 'react';
import { MAX_ASSISTANT_QUESTION_LENGTH } from '../domain/constants.js';
import type { AiAskApiResponse } from '../services/apiClient.js';
import { formatGeminiLabel } from './modelAttribution.js';

/** Machine-readable validation and request error codes for GroundedAssistant. */
export type AssistantErrorCode = 'EMPTY_QUESTION' | 'ASK_FAILED' | 'AQ_CHANGED' | 'AQ_UNAVAILABLE';

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

function formatAssistantMode(
  mode: AiAskApiResponse['mode'],
  isHi: boolean,
  modelUsed?: string,
): string {
  if (mode === 'gemini_interactions') {
    return formatGeminiLabel(modelUsed, isHi);
  }
  if (mode === 'guard_refusal') {
    return isHi ? 'सुरक्षा गार्ड' : 'Safety Guard';
  }
  return isHi ? 'टियर-1 प्रमाणित' : 'Tier-1 Grounded';
}

/** Formats GroundedAssistant validation and API errors into English or Hindi copy. */
export function formatAssistantError(code: AssistantErrorCode | null, isHi: boolean): string {
  if (code === null) {
    return '';
  }
  if (code === 'EMPTY_QUESTION') {
    return isHi
      ? 'कृपया स्मॉग सुरक्षा से जुड़ा प्रश्न लिखें।'
      : 'Please enter a smog safety question first.';
  }
  if (code === 'AQ_CHANGED') {
    return isHi ? 'वायु गुणवत्ता का स्नैपशॉट बदल गया। पेज रीफ़्रेश करें।'
      : 'The air quality snapshot changed. Refresh the page to update the plan.';
  }
  if (code === 'AQ_UNAVAILABLE') {
    return isHi ? 'इस स्थान के लिए प्रतिनिधि वायु गुणवत्ता उपलब्ध नहीं है।'
      : 'Representative air quality is unavailable for this location.';
  }
  return isHi
    ? 'सहायक से उत्तर नहीं मिल सका। कृपया पुनः प्रयास करें।'
    : 'Could not reach the assistant. Please try again.';
}

/** Suggested quick-tap advisor prompt pills. */
export const QuickPromptsBar: React.FC<{
  readonly isHi: boolean;
  readonly onSelect: (prompt: string) => void;
}> = React.memo(function QuickPromptsBar({ isHi, onSelect }) {
  return (
    <div
      role="group"
      aria-label={isHi ? 'त्वरित सलाह प्रश्न' : 'Quick advisor prompts'}
      className="mt-2 flex flex-wrap gap-2"
    >
      {QUICK_PROMPTS.map((item) => {
        const label = isHi ? item.hi : item.en;
        return (
          <button
            key={item.en}
            type="button"
            onClick={() => onSelect(label)}
            className="rounded-full border border-slate-500 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
});

/** Displays the grounded assistant reply, active safety guard badge, and citation chips. */
export const AssistantAnswerCard: React.FC<{
  readonly response: AiAskApiResponse;
  readonly isHi: boolean;
  readonly isStaleObservation?: boolean;
}> = React.memo(function AssistantAnswerCard({
  response, isHi, isStaleObservation = false,
}) {
  return (
    <div className="rounded-md border border-slate-300 bg-slate-50 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded bg-slate-900 px-2 py-0.5 text-white">
          {formatAssistantMode(response.mode, isHi, response.modelUsed)}
        </span>
        {response.guardTriggered && (
          <span className="rounded bg-red-900 px-2 py-0.5 text-white">
            {isHi ? 'सुरक्षा गार्ड सक्रिय' : 'Guard Active'}
          </span>
        )}
      </div>
      {isStaleObservation && (
        <p
          role="status"
          className="mb-2 rounded border border-amber-700 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-950"
        >
          {isHi
            ? 'यह उत्तर पुराने वायु गुणवत्ता डेटा पर आधारित है — वर्तमान डैशबोर्ड के अनुसार नया उत्तर पाने के लिए फिर से पूछें।'
            : 'Based on an earlier air quality reading — ask again to match the current dashboard.'}
        </p>
      )}
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
});

/** Accessible question input form for GroundedAssistant. */
export const AssistantForm: React.FC<{
  readonly question: string;
  readonly isHi: boolean;
  readonly isLoading: boolean;
  readonly hasError: boolean;
  readonly isFieldInvalid: boolean;
  readonly onQuestionChange: (val: string) => void;
  readonly onSubmit: () => void;
}> = React.memo(function AssistantForm({
  question,
  isHi,
  isLoading,
  hasError,
  isFieldInvalid,
  onQuestionChange,
  onSubmit,
}) {
  const placeholderText = isHi
    ? 'स्मॉग, वेंटिलेशन या बजट के बारे में पूछें...'
    : 'Ask about smog, ventilation, or budget...';
  const submitLabel = isLoading ? (isHi ? 'प्रतीक्षा...' : 'Thinking...') : isHi ? 'पूछें' : 'Ask';

  return (
    <form
      noValidate
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
        maxLength={MAX_ASSISTANT_QUESTION_LENGTH}
        aria-invalid={isFieldInvalid}
        aria-describedby={hasError ? 'assistant-error' : undefined}
        onChange={(e) => onQuestionChange(e.target.value)}
        placeholder={placeholderText}
        className="min-w-0 flex-1 rounded-md border border-slate-500 bg-white px-3 py-1.5 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
      />
      <button
        type="submit"
        disabled={isLoading}
        className="rounded-md bg-teal-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-60"
      >
        {submitLabel}
      </button>
    </form>
  );
});
