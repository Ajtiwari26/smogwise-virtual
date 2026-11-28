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
  readonly sessionCheckFailed: boolean;
  readonly retrySessionCheck: () => void;
  readonly hasInteractedAuthRef: React.MutableRefObject<boolean>;
} {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);
  const [sessionCheckFailed, setSessionCheckFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retrySessionCheck = useCallback(() => setAttempt((value) => value + 1), []);
  const hasInteractedAuthRef = useRef<boolean>(false);

  useEffect(() => {
    const controller = new AbortController();
    setIsCheckingSession(true);
    setSessionCheckFailed(false);
    void (async () => {
      try {
        const res = await fetchSession(controller.signal);
        if (!controller.signal.aborted && res.authenticated && res.user !== null) {
          setAuthUser(res.user);
        }
      } catch (err: unknown) {
        void err;
        if (!controller.signal.aborted) {
          setSessionCheckFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsCheckingSession(false);
        }
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  return {
    authUser, setAuthUser, isCheckingSession, sessionCheckFailed, retrySessionCheck,
    hasInteractedAuthRef,
  };
}

function useSignOut(
  onSuccess: () => void,
  flushPendingPrefsRef: React.MutableRefObject<(() => Promise<void> | undefined) | null>,
) {
  const isSigningOutRef = useRef(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState<'save' | 'logout'>();
  const handleSignOut = useCallback((): void => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;
    setIsSigningOut(true);
    setSignOutFailed(undefined);
    void (async () => {
      try {
        try {
          await flushPendingPrefsRef.current?.();
        } catch {
          setSignOutFailed('save');
          return;
        }
        const { ok } = await logoutSession();
        if (ok) onSuccess();
        else setSignOutFailed('logout');
      } catch {
        setSignOutFailed('logout');
      } finally {
        isSigningOutRef.current = false;
        setIsSigningOut(false);
      }
    })();
  }, [flushPendingPrefsRef, onSuccess]);
  return { handleSignOut, signOutFailed, isSigningOut };
}

function useSignOutErrorFocus(signOutFailed: 'save' | 'logout' | undefined): void {
  useEffect(() => {
    if (signOutFailed === undefined) return undefined;
    const rafId = window.requestAnimationFrame(() => {
      document.getElementById('sign-out-error-alert')?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [signOutFailed]);
}

function useAuthFocus(authUser: AuthUser | null, interacted: React.RefObject<boolean>): void {
  useEffect(() => {
    if (!interacted.current) {
      return undefined;
    }
    const targetId = authUser !== null ? 'main-content' : 'login-email';
    const rafId = window.requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [authUser, interacted]);
}

/** Root SmogWise Virtual application layout with authentication gate and WCAG 2.1 AA landmarks. */
export const App: React.FC = function App() {
  const {
    authUser, setAuthUser, isCheckingSession, hasInteractedAuthRef,
    sessionCheckFailed, retrySessionCheck,
  } = useSessionState();
  const [gateLanguage, setGateLanguage] = useState<LanguageCode>('en');
  const flushPendingPrefsRef = useRef<(() => Promise<void> | undefined) | null>(null);
  const registerPrefsFlush = useCallback((fn: () => Promise<void> | undefined) => {
    flushPendingPrefsRef.current = fn;
  }, []);
  const finishSignOut = useCallback(() => {
    hasInteractedAuthRef.current = true;
    setAuthUser(null);
  }, [hasInteractedAuthRef, setAuthUser]);
  const { handleSignOut, signOutFailed, isSigningOut } = useSignOut(
    finishSignOut, flushPendingPrefsRef,
  );

  useEffect(() => {
    if (authUser === null) {
      document.documentElement.lang = gateLanguage;
    }
  }, [authUser, gateLanguage]);

  useAuthFocus(authUser, hasInteractedAuthRef);
  useSignOutErrorFocus(signOutFailed);

  const handleLoginSuccess = useCallback((user: AuthUser): void => {
    hasInteractedAuthRef.current = true;
    setAuthUser(user);
  }, [hasInteractedAuthRef, setAuthUser]);

  if (authUser === null) {
    return (
      <LoginGate
        language={gateLanguage}
        isCheckingSession={isCheckingSession}
        sessionCheckFailed={sessionCheckFailed}
        onRetrySessionCheck={retrySessionCheck}
        onLanguageChange={setGateLanguage}
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <AuthenticatedWorkspace
      authUser={authUser}
      onSignOut={handleSignOut}
      {...(signOutFailed === undefined ? {} : { signOutFailed })}
      isSigningOut={isSigningOut}
      onRegisterPrefsFlush={registerPrefsFlush}
    />
  );
};

/** Default root SmogWise Virtual component export for Vite and test mounts. */
export default App;
