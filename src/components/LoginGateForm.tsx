/**
 * Accessible email/password credential login form with ARIA error wiring and Show/Hide control.
 */

import React from 'react';

function getSubmitButtonText(isSubmitting: boolean, isHi: boolean): string {
  if (isSubmitting) {
    return isHi ? 'सत्यापन हो रहा है...' : 'Signing in...';
  }
  return isHi ? 'डैशबोर्ड खोलें' : 'Sign In to Dashboard';
}

interface EmailFieldProps {
  readonly isHi: boolean;
  readonly email: string;
  readonly hasError: boolean;
  readonly onEmailChange: (value: string) => void;
}

const EmailField: React.FC<EmailFieldProps> = React.memo(function EmailField({
  isHi,
  email,
  hasError,
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
        aria-invalid={hasError}
        aria-describedby={hasError ? 'login-error-alert' : undefined}
        value={email}
        onChange={(e) => onEmailChange(e.target.value)}
        className="mt-1 block w-full rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
      />
    </div>
  );
});

interface PasswordFieldProps {
  readonly isHi: boolean;
  readonly password: string;
  readonly showPassword: boolean;
  readonly hasError: boolean;
  readonly onPasswordChange: (value: string) => void;
  readonly onToggleShowPassword: () => void;
}

const PasswordField: React.FC<PasswordFieldProps> = React.memo(function PasswordField({
  isHi,
  password,
  showPassword,
  hasError,
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
          aria-invalid={hasError}
          aria-describedby={hasError ? 'login-error-alert' : undefined}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="block w-full rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
        />
        <button
          type="button"
          aria-controls="login-password"
          aria-pressed={showPassword}
          onClick={onToggleShowPassword}
          className="shrink-0 rounded-lg border border-slate-500 bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
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
      <div id="login-error-alert" role="alert" aria-live="polite" className="min-h-[1.25rem]">
        {errorMessage !== null && (
          <p className="rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
            {errorMessage}
          </p>
        )}
      </div>
    );
  },
);

/** Props for CredentialFormSection. */
export interface CredentialFormProps {
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

/** Accessible email/password credential sign-in card with explicit error bindings. */
export function CredentialFormSection(props: CredentialFormProps): React.ReactElement {
  const { isHi, isSubmitting, isCheckingSession } = props;
  const isBusy = isSubmitting || isCheckingSession;
  const hasError = props.errorMessage !== null;
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
      <form noValidate onSubmit={props.onSubmit} className="mt-4 space-y-4">
        <EmailField
          isHi={isHi}
          email={props.email}
          hasError={hasError}
          onEmailChange={props.onEmailChange}
        />
        <PasswordField
          isHi={isHi}
          password={props.password}
          showPassword={props.showPassword}
          hasError={hasError}
          onPasswordChange={props.onPasswordChange}
          onToggleShowPassword={props.onToggleShowPassword}
        />
        <AuthErrorAlert errorMessage={props.errorMessage} />
        <button
          type="submit"
          disabled={isBusy}
          className="w-full rounded-lg bg-teal-800 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {btnText}
        </button>
      </form>
    </section>
  );
}
