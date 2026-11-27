// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../../src/components/Header.js';
import { LoginGate } from '../../src/components/LoginGate.js';
import { resolveCityPreset } from '../../src/domain/cityPresets.js';
import type { AuthUser } from '../../src/services/apiClient.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const sampleUser: AuthUser = {
  id: 'eval-family',
  email: 'family.eval@smogwise.in',
  name: 'Delhi Family',
  personaId: 'young_family',
  defaultLang: 'en',
  defaultCityId: 'delhi_anand_vihar',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LoginGate inputs, password toggle & evaluator directory', () => {
  it('renders accessible Email/Password labels, password toggle, and all 5 accounts', () => {
    render(
      <LoginGate
        language="en"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={vi.fn()}
      />,
    );

    const emailInput = screen.getByLabelText(/Email Address/i);
    const passwordInput = screen.getByLabelText(/^Password$/i);
    expect(emailInput).toHaveAttribute('id', 'login-email');
    expect(passwordInput).toHaveAttribute('id', 'login-password');
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: /^Show$/i });
    expect(toggleBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: /^Hide$/i })).toHaveAttribute('aria-pressed', 'true');

    const body = document.body.textContent ?? '';
    expect(body).toContain('SmogWise#Eval2026');
    for (const email of [
      'family.eval@smogwise.in',
      'senior.eval@smogwise.in',
      'rwa.eval@smogwise.in',
      'commuter.eval@smogwise.in',
      'student.eval@smogwise.in',
    ]) {
      expect(body).toContain(email);
    }
  });
});

describe('LoginGate authentication submission & error handling', () => {
  it('shows role=alert on 401 and 429 failures without calling onLoginSuccess', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'INVALID_CREDENTIALS' }, 401))
      .mockResolvedValueOnce(jsonResponse({ error: 'RATE_LIMITED' }, 429));
    vi.stubGlobal('fetch', fetchMock);
    const onLoginSuccess = vi.fn();

    render(
      <LoginGate
        language="en"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={onLoginSuccess}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'wrong@smogwise.in' },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'badpass' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In to Dashboard/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Invalid email or password/i);
    });
    expect(onLoginSuccess).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Sign In to Dashboard/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Too many sign-in attempts/i);
    });
    expect(onLoginSuccess).not.toHaveBeenCalled();
  });

  it('logs in via 1-Click Delhi Family button and calls onLoginSuccess(user)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ user: sampleUser }));
    vi.stubGlobal('fetch', fetchMock);
    const onLoginSuccess = vi.fn();

    render(
      <LoginGate
        language="en"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={onLoginSuccess}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Delhi Family/i }));

    await waitFor(() => {
      expect(onLoginSuccess).toHaveBeenCalledWith(sampleUser);
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'family.eval@smogwise.in',
        password: 'SmogWise#Eval2026',
      }),
    });
  });
});

describe('LoginGate bilingual mode & Header auth controls', () => {
  it('renders Hindi Devanagari headings and buttons when language switches EN -> HI', () => {
    const { rerender } = render(
      <LoginGate
        language="en"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={vi.fn()}
      />,
    );
    rerender(
      <LoginGate
        language="hi"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: /स्मॉगवाइज़ में साइन इन करें/i })).toBeVisible();
    expect(screen.getByRole('button', { name: /डैशबोर्ड खोलें/i })).toBeVisible();
  });

  it('renders user badge and Sign Out in authenticated Header, and hides city select in gate mode', () => {
    const onSignOut = vi.fn();
    const city = resolveCityPreset('delhi_anand_vihar');
    const { container, rerender } = render(
      <Header
        city={city}
        language="en"
        dataSource="city_preset"
        isSyncing={false}
        onCityChange={vi.fn()}
        onLanguageChange={vi.fn()}
        isAuthenticated={true}
        authUser={sampleUser}
        onSignOut={onSignOut}
      />,
    );

    expect(screen.getByText('Delhi Family')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#header-city-select')).not.toBeNull();

    rerender(
      <Header
        city={city}
        language="en"
        dataSource="city_preset"
        isSyncing={false}
        onCityChange={vi.fn()}
        onLanguageChange={vi.fn()}
        isAuthenticated={false}
      />,
    );
    expect(container.querySelector('#header-city-select')).toBeNull();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });

  it('wires form ARIA validation errors on empty submit, rate limit, API error, and network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'RATE_LIMITED' }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'SERVER_ERR', message: 'Maintenance window' }, 503))
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const { rerender } = render(
      <LoginGate
        language="en"
        isCheckingSession={true}
        onLanguageChange={vi.fn()}
        onLoginSuccess={vi.fn()}
      />,
    );
    expect(screen.getByText('Checking active session...')).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Sign In to Dashboard/i });
    expect(submitBtn).toBeDisabled();

    rerender(
      <LoginGate
        language="en"
        isCheckingSession={false}
        onLanguageChange={vi.fn()}
        onLoginSuccess={vi.fn()}
      />,
    );
    fireEvent.click(submitBtn);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Please enter both email address and password');
    expect(screen.getByLabelText(/Email Address/i)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/Email Address/i)).toHaveAttribute('aria-describedby', 'login-error-alert');

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'secret123' } });
    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Too many sign-in attempts');
    });

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Maintenance window');
    });

    fireEvent.click(submitBtn);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Unable to reach authentication service');
    });
  });
});
