/**
 * Accessible authentication gateway for SmogWise Virtual with localized error state.
 */

import React, { useCallback, useState } from 'react';
import type { LanguageCode } from '../domain/types.js';
import { ApiError, loginSession, type AuthUser } from '../services/apiClient.js';
import { AppFooter } from './AppFooter.js';
import { Header } from './Header.js';
import { EvaluatorSandboxCard, SecurityHighlightsStrip } from './LoginGateCards.js';
import { CredentialFormSection } from './LoginGateForm.js';

/** Props for the LoginGate authentication screen. */
export interface LoginGateProps {
  readonly language: LanguageCode;
  readonly isCheckingSession: boolean;
  readonly sessionCheckFailed?: boolean;
  readonly onRetrySessionCheck?: () => void;
  readonly onLanguageChange: (lang: LanguageCode) => void;
  readonly onLoginSuccess: (user: AuthUser) => void;
}

type AuthErrorState =
  | { readonly kind: 'missing_fields' }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'invalid_credentials' }
  | { readonly kind: 'network' }
  | { readonly kind: 'api_message'; readonly message: string };

function classifyAuthError(err: unknown): AuthErrorState {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return { kind: 'rate_limited' };
    }
    if (err.status === 401) {
      return { kind: 'invalid_credentials' };
    }
    return { kind: 'api_message', message: err.message };
  }
  return { kind: 'network' };
}

const AUTH_ERROR_MESSAGES: Readonly<
  Record<Exclude<AuthErrorState['kind'], 'api_message'>, { readonly en: string; readonly hi: string }>
> = {
  missing_fields: {
    en: 'Please enter both email address and password.',
    hi: 'कृपया ईमेल और पासवर्ड दोनों दर्ज करें।',
  },
  rate_limited: {
    en: 'Too many sign-in attempts. Please wait a minute and try again.',
    hi: 'बहुत अधिक लॉगिन प्रयास। कृपया एक मिनट बाद पुनः प्रयास करें।',
  },
  invalid_credentials: {
    en: 'Invalid email or password. Please verify your credentials.',
    hi: 'अमान्य ईमेल या पासवर्ड। कृपया विवरण जांचें।',
  },
  network: {
    en: 'Unable to reach authentication service. Please check your connection and try again.',
    hi: 'प्रमाणीकरण सर्वर से कनेक्ट नहीं हो सका। कृपया पुनः प्रयास करें।',
  },
};

function formatAuthError(state: AuthErrorState | null, language: LanguageCode): string | null {
  if (state === null) {
    return null;
  }
  if (state.kind === 'api_message') {
    return state.message;
  }
  const copy = AUTH_ERROR_MESSAGES[state.kind];
  return language === 'hi' ? copy.hi : copy.en;
}

const GatewayStatusBanner: React.FC<{
  readonly isHi: boolean;
  readonly isCheckingSession: boolean;
}> = React.memo(function GatewayStatusBanner({ isHi, isCheckingSession }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border border-amber-700 bg-amber-50 px-4 py-3 text-sm text-slate-900"
    >
      <p className="font-bold text-slate-900">
        {isHi
          ? 'शीतकालीन स्मॉग सुरक्षा गेटवे · CPCB AQI Very Poor / Severe तत्परता'
          : 'Winter Smog Preparedness Gateway · CPCB AQI Very Poor / Severe Readiness'}
      </p>
      {isCheckingSession && (
        <p className="mt-1 text-xs font-medium text-slate-700">
          {isHi ? 'सक्रिय सत्र की जांच हो रही है...' : 'Checking active session...'}
        </p>
      )}
    </div>
  );
});

interface UseLoginGateStateResult {
  readonly email: string;
  readonly password: string;
  readonly showPassword: boolean;
  readonly isSubmitting: boolean;
  readonly errorState: AuthErrorState | null;
  readonly setEmail: (value: string) => void;
  readonly setPassword: (value: string) => void;
  readonly handleTogglePassword: () => void;
  readonly handleFormSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly handleQuickLogin: (demoEmail: string, demoPassword: string) => void;
}

function usePerformLogin(
  onLoginSuccess: (user: AuthUser) => void,
  setIsSubmitting: React.Dispatch<React.SetStateAction<boolean>>,
  setErrorState: React.Dispatch<React.SetStateAction<AuthErrorState | null>>,
): (targetEmail: string, targetPassword: string) => Promise<void> {
  return useCallback(
    async (targetEmail: string, targetPassword: string): Promise<void> => {
      if (targetEmail.trim().length === 0 || targetPassword.length === 0) {
        setErrorState({ kind: 'missing_fields' });
        return;
      }
      setErrorState(null);
      setIsSubmitting(true);
      try {
        const res = await loginSession(targetEmail, targetPassword);
        onLoginSuccess(res.user);
      } catch (err: unknown) {
        setErrorState(classifyAuthError(err));
      } finally {
        setIsSubmitting(false);
      }
    },
    [onLoginSuccess, setErrorState, setIsSubmitting],
  );
}

function useLoginGateState(
  onLoginSuccess: (user: AuthUser) => void,
): UseLoginGateStateResult {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorState, setErrorState] = useState<AuthErrorState | null>(null);
  const performLogin = usePerformLogin(onLoginSuccess, setIsSubmitting, setErrorState);

  const handleFormSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>): void => {
      event.preventDefault();
      void performLogin(email, password);
    },
    [email, password, performLogin],
  );

  const handleQuickLogin = useCallback(
    (demoEmail: string, demoPassword: string): void => {
      setEmail(demoEmail);
      setPassword(demoPassword);
      void performLogin(demoEmail, demoPassword);
    },
    [performLogin],
  );

  const handleTogglePassword = useCallback((): void => {
    setShowPassword((prev) => !prev);
  }, []);

  return {
    email,
    password,
    showPassword,
    isSubmitting,
    errorState,
    setEmail,
    setPassword,
    handleTogglePassword,
    handleFormSubmit,
    handleQuickLogin,
  };
}

function SessionCheckNotice({ failed, isHi, onRetry }: {
  readonly failed: boolean;
  readonly isHi: boolean;
  readonly onRetry: (() => void) | undefined;
}): React.ReactElement | null {
  if (!failed) return null;
  return (
          <div className="rounded border border-amber-700 bg-amber-50 p-3">
            <p role="alert">
              {isHi ? 'साइन-इन सत्र की जाँच नहीं हो सकी।' : 'Could not check your sign-in session.'}
            </p>
            <button type="button" onClick={onRetry} className="underline">
              {isHi ? 'फिर से जाँचें' : 'Retry session check'}
            </button>
          </div>
  );
}

function getFieldErrors(gate: UseLoginGateStateResult) {
  const invalid = gate.errorState?.kind === 'invalid_credentials';
  const missing = gate.errorState?.kind === 'missing_fields';
  return {
    invalidEmail: invalid || (missing && gate.email.trim() === ''),
    invalidPassword: invalid || (missing && gate.password === ''),
  };
}

/** Accessible authentication gateway for SmogWise Virtual. */
export function LoginGate({
  language,
  isCheckingSession,
  onLanguageChange,
  onLoginSuccess,
  sessionCheckFailed = false,
  onRetrySessionCheck,
}: LoginGateProps): React.ReactElement {
  const gate = useLoginGateState(onLoginSuccess);
  const isHi = language === 'hi';
  const errorMessage = formatAuthError(gate.errorState, language);
  const { invalidEmail, invalidPassword } = getFieldErrors(gate);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        language={language}
        onLanguageChange={onLanguageChange}
        isAuthenticated={false}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto max-w-6xl space-y-5 px-4 py-6 focus:outline-none"
      >
        <GatewayStatusBanner isHi={isHi} isCheckingSession={isCheckingSession} />
        <SessionCheckNotice
          failed={sessionCheckFailed} isHi={isHi} onRetry={onRetrySessionCheck} />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CredentialFormSection
            isHi={isHi}
            email={gate.email}
            password={gate.password}
            showPassword={gate.showPassword}
            isSubmitting={gate.isSubmitting}
            isCheckingSession={isCheckingSession}
            errorMessage={errorMessage}
            invalidEmail={invalidEmail}
            invalidPassword={invalidPassword}
            onEmailChange={gate.setEmail}
            onPasswordChange={gate.setPassword}
            onToggleShowPassword={gate.handleTogglePassword}
            onSubmit={gate.handleFormSubmit}
          />
          <EvaluatorSandboxCard
            language={language}
            isSubmitting={gate.isSubmitting || isCheckingSession}
            onQuickLogin={gate.handleQuickLogin}
          />
        </div>
        <SecurityHighlightsStrip language={language} />
      </main>
      <AppFooter language={language} />
    </div>
  );
}
