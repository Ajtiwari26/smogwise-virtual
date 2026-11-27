/**
 * Root SmogWise Virtual application layout with authentication gate and WCAG 2.1 AA landmarks.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AuthenticatedWorkspace } from './components/AuthenticatedWorkspace.js';
import { LoginGate } from './components/LoginGate.js';
import type { LanguageCode } from './domain/types.js';
import { fetchSession, logoutSession, type AuthUser } from './services/apiClient.js';

function useSessionState(): {
  readonly authUser: AuthUser | null;
  readonly setAuthUser: React.Dispatch<React.SetStateAction<AuthUser | null>>;
  readonly isCheckingSession: boolean;
  readonly hasInteractedAuthRef: React.MutableRefObject<boolean>;
} {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const hasInteractedAuthRef = useRef<boolean>(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetchSession(controller.signal);
        if (!controller.signal.aborted && res.authenticated && res.user !== null) {
          setAuthUser(res.user);
        }
      } catch (err: unknown) {
        void err;
        if (!controller.signal.aborted) {
          setAuthUser(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingSession(false);
        }
      }
    })();
    return () => controller.abort();
  }, []);

  return { authUser, setAuthUser, isCheckingSession, hasInteractedAuthRef };
}

function useSignOut(onSuccess: () => void) {
  const isSigningOutRef = useRef<boolean>(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const handleSignOut = useCallback((): void => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;
    setSignOutFailed(false);
    void logoutSession()
      .then(({ ok }) => {
        if (ok) onSuccess();
        else setSignOutFailed(true);
      })
      .catch((err: unknown) => {
        void err;
        setSignOutFailed(true);
      })
      .finally(() => {
        isSigningOutRef.current = false;
      });
  }, [onSuccess]);

  return { handleSignOut, signOutFailed };
}

/** Root SmogWise Virtual application layout with authentication gate and WCAG 2.1 AA landmarks. */
export const App: React.FC = function App() {
  const { authUser, setAuthUser, isCheckingSession, hasInteractedAuthRef } = useSessionState();
  const [gateLanguage, setGateLanguage] = useState<LanguageCode>('en');
  const finishSignOut = useCallback(() => {
    hasInteractedAuthRef.current = true;
    setAuthUser(null);
  }, [hasInteractedAuthRef, setAuthUser]);
  const { handleSignOut, signOutFailed } = useSignOut(finishSignOut);

  useEffect(() => {
    if (authUser === null) {
      document.documentElement.lang = gateLanguage;
    }
  }, [authUser, gateLanguage]);

  useEffect(() => {
    if (!hasInteractedAuthRef.current) {
      return undefined;
    }
    const targetId = authUser !== null ? 'main-content' : 'login-email';
    const rafId = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [authUser, hasInteractedAuthRef]);

  const handleLoginSuccess = useCallback((user: AuthUser): void => {
    hasInteractedAuthRef.current = true;
    setAuthUser(user);
  }, [hasInteractedAuthRef, setAuthUser]);

  if (authUser === null) {
    return (
      <LoginGate
        language={gateLanguage}
        isCheckingSession={isCheckingSession}
        onLanguageChange={setGateLanguage}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <AuthenticatedWorkspace
      authUser={authUser}
      onSignOut={handleSignOut}
      signOutFailed={signOutFailed}
    />
  );
};

/** Default root SmogWise Virtual component export for Vite and test mounts. */
export default App;
