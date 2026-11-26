import React, { useCallback, useState } from 'react';
import { resolveCityPreset } from '../domain/cityPresets.js';
import type { LanguageCode } from '../domain/types.js';
import { ApiError, loginSession, type AuthUser } from '../services/apiClient.js';
import { Header } from './Header.js';
import { EvaluatorSandboxCard, SecurityHighlightsStrip } from './LoginGateCards.js';

/** Props for the LoginGate authentication screen. */
export interface LoginGateProps {
  readonly language: LanguageCode;
  readonly isCheckingSession: boolean;
  readonly onLanguageChange: (lang: LanguageCode) => void;
  readonly onLoginSuccess: (user: AuthUser) => void;
}

function formatAuthError(err: unknown, language: LanguageCode): string {
  const isHi = language === 'hi';
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return isHi
        ? 'बहुत अधिक लॉगिन प्रयास। कृपया एक मिनट बाद पुनः प्रयास करें।'
        : 'Too many sign-in attempts. Please wait a minute and try again.';
    }
    if (err.status === 401) {
      return isHi
        ? 'अमान्य ईमेल या पासवर्ड। कृपया विवरण जांचें।'
        : 'Invalid email or password. Please verify your credentials.';
    }
    return err.message;
  }
  return isHi
    ? 'प्रमाणीकरण सर्वर से कनेक्ट नहीं हो सका। कृपया पुनः प्रयास करें।'
    : 'Unable to reach authentication service. Please check your connection and try again.';
}

function getSubmitButtonText(isSubmitting: boolean, isHi: boolean): string {
  if (isSubmitting) {
    return isHi ? 'सत्यापन हो रहा है...' : 'Signing in...';
  }
  return isHi ? 'डैशबोर्ड खोलें' : 'Sign In to Dashboard';
}

interface EmailFieldProps {
  readonly isHi: boolean;
  readonly email: string;
  readonly onEmailChange: (value: string) => void;
}

const EmailField: React.FC<EmailFieldProps> = React.memo(function EmailField({
  isHi,
  email,
  onEmailChange,
}) {
  return (
    <div>
      <label htmlFor="login-email" className="block text-sm font-semibold text-slate-900">
        {isHi ? 'ईमेल पता' : 'Email Address'}
      </label>
      <input
        id="login-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
      />
    </div>
  );
});

interface PasswordFieldProps {
  readonly isHi: boolean;
  readonly password: string;
  readonly showPassword: boolean;
  readonly onPasswordChange: (value: string) => void;
  readonly onToggleShowPassword: () => void;
}

const PasswordField: React.FC<PasswordFieldProps> = React.memo(function PasswordField({
  isHi,
  password,
  showPassword,
  onPasswordChange,
  onToggleShowPassword,
}) {
  const toggleLabel = showPassword ? (isHi ? 'छिपाएं' : 'Hide') : isHi ? 'दिखाएं' : 'Show';
  return (
    <div>
      <label htmlFor="login-password" className="block text-sm font-semibold text-slate-900">
        {isHi ? 'पासवर्ड' : 'Password'}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="login-password"
          type={showPassword ? 'text' : 'password'}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <button
          type="button"
          aria-pressed={showPassword}
          onClick={onToggleShowPassword}
          className="shrink-0 rounded-lg border border-slate-400 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-teal-700"
        >
          {toggleLabel}
        </button>
      </div>
    </div>
  );
});

const AuthErrorAlert: React.FC<{ readonly errorMessage: string | null }> = React.memo(
  function AuthErrorAlert({ errorMessage }) {
    return (
      <div role="alert" aria-live="polite" className="min-h-[1.25rem]">
        {errorMessage !== null && (
          <p className="rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);

interface CredentialFormProps {
  readonly isHi: boolean;
  readonly email: string;
  readonly password: string;
  readonly showPassword: boolean;
  readonly isSubmitting: boolean;
  readonly isCheckingSession: boolean;
  readonly errorMessage: string | null;
  readonly onEmailChange: (value: string) => void;
  readonly onPasswordChange: (value: string) => void;
  readonly onToggleShowPassword: () => void;
  readonly onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

function CredentialFormSection(props: CredentialFormProps): React.ReactElement {
  const { isHi, isSubmitting, isCheckingSession } = props;
  const isBusy = isSubmitting || isCheckingSession;
  const heading = isHi ? 'स्मॉगवाइज़ में साइन इन करें' : 'Sign In to SmogWise Workspace';
  const subtitle = isHi
    ? 'व्यक्तिगत CPCB AQI योजना और परिवार सुरक्षा डैशबोर्ड खोलें।'
    : 'Access personalized CPCB AQI exposure modeling and household GRAP plans.';
  const btnText = getSubmitButtonText(isSubmitting, isHi);
  return (
    <section
      id="gateway-login"
      aria-labelledby="gateway-login-heading"
      className="rounded-xl border border-slate-300 bg-white p-6 shadow-sm"
    >
      <h2 id="gateway-login-heading" className="text-lg font-bold text-slate-900">
        {heading}
      </h2>
      <p className="mt-1 text-sm text-slate-700">{subtitle}</p>
      <form onSubmit={props.onSubmit} className="mt-4 space-y-4">
        <EmailField isHi={isHi} email={props.email} onEmailChange={props.onEmailChange} />
        <PasswordField
          isHi={isHi}
          password={props.password}
          showPassword={props.showPassword}
          onPasswordChange={props.onPasswordChange}
          onToggleShowPassword={props.onToggleShowPassword}
        />
        <AuthErrorAlert errorMessage={props.errorMessage} />
        <button
          type="submit"
          disabled={isBusy}
          className="w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-900 focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {btnText}
        </button>
      </form>
    </section>
  );
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
  readonly errorMessage: string | null;
  readonly setEmail: (value: string) => void;
  readonly setPassword: (value: string) => void;
  readonly handleTogglePassword: () => void;
  readonly handleFormSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly handleQuickLogin: (demoEmail: string, demoPassword: string) => void;
}

function useLoginGateState(
  language: LanguageCode,
  onLoginSuccess: (user: AuthUser) => void,
): UseLoginGateStateResult {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const performLogin = useCallback(
    async (targetEmail: string, targetPassword: string): Promise<void> => {
      setErrorMessage(null);
      setIsSubmitting(true);
      try {
        const res = await loginSession(targetEmail, targetPassword);
        onLoginSuccess(res.user);
      } catch (err: unknown) {
        setErrorMessage(formatAuthError(err, language));
      } finally {
        setIsSubmitting(false);
      }
    },
    [language, onLoginSuccess],
  );

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
    errorMessage,
    setEmail,
    setPassword,
    handleTogglePassword,
    handleFormSubmit,
    handleQuickLogin,
  };
}

const NOOP_CITY_CHANGE = (): void => undefined;

interface LoginGateBodyProps {
  readonly language: LanguageCode;
  readonly isCheckingSession: boolean;
  readonly gate: UseLoginGateStateResult;
}

function LoginGateBody({
  language,
  isCheckingSession,
  gate,
}: LoginGateBodyProps): React.ReactElement {
  const isHi = language === 'hi';
  return (
    <main id="main-content" className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <GatewayStatusBanner isHi={isHi} isCheckingSession={isCheckingSession} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CredentialFormSection
          isHi={isHi}
          email={gate.email}
          password={gate.password}
          showPassword={gate.showPassword}
          isSubmitting={gate.isSubmitting}
          isCheckingSession={isCheckingSession}
          errorMessage={gate.errorMessage}
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
  );
}

/** Accessible authentication gateway for SmogWise Virtual. */
export function LoginGate({
  language,
  isCheckingSession,
  onLanguageChange,
  onLoginSuccess,
}: LoginGateProps): React.ReactElement {
  const gate = useLoginGateState(language, onLoginSuccess);
  const isHi = language === 'hi';
  const gateCity = resolveCityPreset('delhi_anand_vihar');
  const footerText = isHi
    ? 'SmogWise Virtual · सत्यापित Tier-1 भौतिकी मॉडल + ग्राउंडेड AI मार्गदर्शन'
    : 'SmogWise Virtual · Deterministic Tier-1 Physics Engine + Grounded AI Guidance';

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Header
        city={gateCity}
        language={language}
        dataSource="city_preset"
        isSyncing={isCheckingSession}
        onCityChange={NOOP_CITY_CHANGE}
        onLanguageChange={onLanguageChange}
        isAuthenticated={false}
      />
      <LoginGateBody language={language} isCheckingSession={isCheckingSession} gate={gate} />
      <footer className="mt-8 border-t border-slate-300 bg-white py-4 text-center text-xs text-slate-700">
        {footerText}
      </footer>
    </div>
  );
}
