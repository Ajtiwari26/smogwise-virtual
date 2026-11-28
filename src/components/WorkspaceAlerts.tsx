/** Workspace recovery messages for session and preference failures. */

import type { LanguageCode } from '../domain/types.js';
import type { SaveErrorKind } from '../hooks/usePreferenceSync.js';

interface AlertsProps {
  readonly language: LanguageCode;
  readonly signOutFailed?: 'save' | 'logout';
  readonly preferenceError: SaveErrorKind | null;
  readonly recoverPreferences: () => void;
  readonly isSigningOut?: boolean;
}

const COPY = {
  conflict: {
    en: ['Preferences changed elsewhere. Reload the saved profile to resolve the conflict.',
      'Reload saved preferences'],
    hi: ['प्राथमिकताएँ दूसरे सत्र में बदल गईं। सहेजी गई प्राथमिकताएँ फिर से लोड करें।',
      'सहेजी गई प्राथमिकताएँ लोड करें'],
  },
  failed: {
    en: ['Could not save profile preferences.', 'Retry Save'],
    hi: ['प्रोफ़ाइल प्राथमिकताएँ सहेजी नहीं जा सकीं।', 'सहेजने का फिर से प्रयास करें'],
  },
  load: {
    en: ['Could not load saved preferences. Changes are waiting to sync.', 'Retry loading'],
    hi: ['सहेजी गई प्राथमिकताएँ लोड नहीं हो सकीं।', 'लोड करने का फिर से प्रयास करें'],
  },
};

function getSignOutError(reason: AlertsProps['signOutFailed'], language: LanguageCode): string {
  if (reason === 'save') {
    return language === 'hi'
      ? 'प्राथमिकताएँ सहेजी नहीं गईं। साइन आउट से पहले सहेजने की समस्या हल करें।'
      : 'You are still signed in because preferences could not be saved.';
  }
  return language === 'hi'
    ? 'साइन आउट नहीं हो सका। फिर से प्रयास करें।'
    : 'Could not sign out. Please try again.';
}

/** Announces failures and exposes the recovery action appropriate to each error. */
export function WorkspaceAlerts(props: AlertsProps): React.JSX.Element {
  const { language, signOutFailed, preferenceError, recoverPreferences, isSigningOut } = props;
  const copy = preferenceError === null ? undefined : COPY[preferenceError][language];
  return (
    <>
      {signOutFailed && (
        <p
          id="sign-out-error-alert"
          role="alert"
          tabIndex={-1}
          className="rounded border border-red-800 bg-red-50 p-2 text-sm text-red-900 focus:outline-none focus:ring-2 focus:ring-red-700"
        >
          {getSignOutError(signOutFailed, language)}
        </p>
      )}
      {copy && (
        <div className="rounded border border-amber-700 bg-amber-50 p-2 text-sm text-slate-900">
          <p role="status">{copy[0]}</p>
          <button
            type="button"
            disabled={isSigningOut === true}
            onClick={recoverPreferences}
            className="mt-1 rounded border border-amber-800 bg-white px-2.5 py-1 font-semibold text-amber-950 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            {copy[1]}
          </button>
        </div>
      )}
    </>
  );
}
