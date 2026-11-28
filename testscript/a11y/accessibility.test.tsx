// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.js';
import { DEFAULT_PROFILE } from '../../src/hooks/useSmogPlan.js';
import { AuthenticatedWorkspace } from '../../src/components/AuthenticatedWorkspace.js';

const hookThrowState = vi.hoisted(() => ({ shouldThrow: false }));
vi.mock('../../src/hooks/useSmogPlan.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useSmogPlan.js')>();
  return {
    ...actual,
    useSmogPlan: (...args: Parameters<typeof actual.useSmogPlan>) => {
      if (hookThrowState.shouldThrow) {
        throw new Error('Simulated useSmogPlan failure');
      }
      return actual.useSmogPlan(...args);
    },
  };
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: 'offline test mock' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  hookThrowState.shouldThrow = false;
  cleanup();
  vi.restoreAllMocks();
});

describe('App WCAG 2.1 AA landmarks, labels & bilingual semantics', () => {
  it('renders a single h1, skip link, and semantic landmarks', () => {
    const { container } = render(<App />);

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);

    const skipLink = container.querySelector('a[href="#main-content"]');
    expect(skipLink).not.toBeNull();

    expect(container.querySelector('header')).not.toBeNull();
    expect(container.querySelector('main#main-content')?.getAttribute('tabindex')).toBe('-1');
    expect(container.querySelector('nav')).not.toBeNull();
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('exposes aria-live regions and htmlFor-associated form labels', () => {
    const { container } = render(<App />);
    const liveRegions = container.querySelectorAll('[aria-live]');
    expect(liveRegions.length).toBeGreaterThan(0);

    const labels = container.querySelectorAll('label[for]');
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      const targetId = label.getAttribute('for');
      expect(typeof targetId).toBe('string');
      expect((targetId ?? '').length).toBeGreaterThan(0);
      if (targetId !== null) {
        expect(document.getElementById(targetId)).not.toBeNull();
      }
    }
  });

  it('toggles EN -> HI, updates documentElement.lang, and renders Devanagari', () => {
    render(<App />);
    const hiButton = screen.getByRole('button', { name: /हिन्दी|Hindi/i });
    fireEvent.click(hiButton);

    expect(document.documentElement.lang).toBe('hi');
    expect(document.body.textContent ?? '').toMatch(/[\u0900-\u097F]/);
  });

  it('displays non-color-only CPCB AQI severity text labels', () => {
    render(<App />);
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Good|Satisfactory|Moderate|Poor|Very Poor|Severe/i);
  });
});

function buildEvalJsonRes(body: unknown, status = 200, etag = '"v0"'): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', etag },
  });
}

function getRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

const EVAL_USER = {
  id: 'eval-family',
  email: 'family.eval@smogwise.in',
  name: 'Delhi Family',
  personaId: 'young_family',
  defaultLang: 'en',
  defaultCityId: 'delhi_anand_vihar',
} as const;

interface DelayedAuthHooks {
  readonly onSessionCheck?: () => Response;
  readonly onPrefsPut?: (profile: unknown) => Promise<Response>;
  readonly onPrefsGet: () => Promise<Response>;
  readonly onLogout: () => Promise<Response>;
}

function handlePreferencesMock(
  init: RequestInit | undefined,
  hooks: DelayedAuthHooks,
): Promise<Response> {
  if (init?.method !== 'PUT') return hooks.onPrefsGet();
  const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : {};
  return hooks.onPrefsPut?.(parsed.profile) ??
    Promise.resolve(buildEvalJsonRes({ profile: parsed.profile ?? null }, 200, '"v1"'));
}

function createAuthFetchMock(hooks: DelayedAuthHooks) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = getRequestUrl(input);
    if (url.includes('/api/auth/session')) {
      return Promise.resolve(
        hooks.onSessionCheck?.() ?? buildEvalJsonRes({ authenticated: true, user: EVAL_USER }),
      );
    }
    if (url.includes('/api/user/preferences')) return handlePreferencesMock(init, hooks);
    if (url.includes('/api/auth/logout')) return hooks.onLogout();
    if (url.includes('/api/auth/login')) return Promise.resolve(buildEvalJsonRes({ user: EVAL_USER }));
    return Promise.resolve(buildEvalJsonRes({ error: 'offline test mock' }, 503));
  };
}

describe('App authenticated session lifecycle & landmarks', () => {
  it('logs in via 1-Click Evaluator Access, renders authenticated dashboard landmarks, and signs out cleanly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      createAuthFetchMock({
        onSessionCheck: () => buildEvalJsonRes({ authenticated: false, user: null }, 200),
        onPrefsGet: () => Promise.resolve(buildEvalJsonRes({ profile: null })),
        onLogout: () => Promise.resolve(buildEvalJsonRes({ ok: true })),
      }),
    );

    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delhi Family/i })).not.toBeDisabled();
    });
    expect(container.querySelector('header')?.textContent ?? '').not.toContain(
      'Offline City Preset',
    );

    fireEvent.click(screen.getByRole('button', { name: /Delhi Family/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sign Out/i })).not.toBeNull();
    });
    expect(container.querySelector('main#main-content')?.getAttribute('tabindex')).toBe('-1');
    expect(container.querySelector('#impact')).not.toBeNull();
    expect(container.querySelector('table caption')).not.toBeNull();
    expect(container.querySelector('fieldset legend')).not.toBeNull();
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
    expect(document.body.textContent ?? '').toContain('Direct Health & Emissions Impact');

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(1150);
    } finally {
      vi.useRealTimers();
    }
    const preferencePutCalls = fetchSpy.mock.calls.filter(([input, init]) => {
      return getRequestUrl(input).includes('/api/user/preferences') && init?.method === 'PUT';
    });
    expect(preferencePutCalls).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    await waitFor(() => {
      expect(container.querySelector('#gateway-login')).not.toBeNull();
    });
    expect(container.querySelector('#impact')).toBeNull();
  });

  it('locks duplicate Sign Out clicks, flushes pre-signout edits before logout, and protects pre-hydration edits', async () => {
    let resolvePrefs!: (res: Response) => void;
    let resolveLogout!: (res: Response) => void;
    let logoutCalls = 0;
    let acknowledgeSave: (() => void) | undefined;
    let savedProfile: unknown;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      createAuthFetchMock({
        onPrefsGet: () => new Promise<Response>((r) => { resolvePrefs = r; }),
        onPrefsPut: (profile) => new Promise((resolve) => {
          savedProfile = profile;
          acknowledgeSave = () => resolve(buildEvalJsonRes({ profile }, 200, '"v1"'));
        }),
        onLogout: () => {
          logoutCalls += 1;
          return new Promise<Response>((r) => { resolveLogout = r; });
        },
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Sign Out/i })).toBeInTheDocument();
    });

    // User switches language to Hindi BEFORE preferences GET resolves
    fireEvent.click(screen.getByRole('button', { name: /हिन्दी|Hindi/i }));
    expect(document.documentElement.lang).toBe('hi');

    // Delayed hydration arrives with English profile; must NOT clobber pre-hydration Hindi edit
    resolvePrefs(
      buildEvalJsonRes({
        profile: {
          persona: 'rwa_coordinator',
          cityId: 'gurugram_dlf',
          language: 'en',
          householdSize: 4,
          hasVulnerableMember: false,
          monthlyBudgetInr: 4000,
          roomVolumeM3: 50,
          commuteMode: 'metro_bus',
          commuteDistanceKm: 15,
          cookingFuel: 'lpg',
          activeHacks: ['window_sealing'],
        },
      }),
    );
    await waitFor(() => {
      expect(document.documentElement.lang).toBe('hi');
    });

    const signOutBtn = screen.getByRole('button', { name: /Sign Out|लॉग आउट/i });
    fireEvent.click(signOutBtn);
    fireEvent.click(signOutBtn);
    await waitFor(() => expect(acknowledgeSave).toBeTypeOf('function'));
    expect(logoutCalls).toBe(0);
    expect(savedProfile).toMatchObject({ language: 'hi' });
    await act(async () => acknowledgeSave?.());
    await waitFor(() => expect(logoutCalls).toBe(1));
    const preSignOutPuts = fetchSpy.mock.calls.filter(([input, init]) => {
      return getRequestUrl(input).includes('/api/user/preferences') && init?.method === 'PUT';
    });
    expect(preSignOutPuts).toHaveLength(1);
    expect(new Headers(preSignOutPuts[0]?.[1]?.headers).get('If-Match')).toBe('"v0"');
    resolveLogout(buildEvalJsonRes({ ok: true }));
    await waitFor(() => {
      expect(document.getElementById('gateway-login')).not.toBeNull();
    });
  });

  it('persists debounced profile edits via PUT /api/user/preferences after hydration completes', async () => {
    let resolvePrefs: ((response: Response) => void) | undefined;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      createAuthFetchMock({
        onPrefsGet: () => new Promise<Response>((resolve) => { resolvePrefs = resolve; }),
        onLogout: () => Promise.resolve(buildEvalJsonRes({ ok: true })),
      }),
    );

    render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Household Size/i)).toBeInTheDocument();
    });
    expect(resolvePrefs).toBeTypeOf('function');
    await act(async () => {
      resolvePrefs?.(buildEvalJsonRes({ profile: null }));
    });

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText(/Household Size/i), { target: { value: '6' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
    } finally {
      vi.useRealTimers();
    }

    const putCalls = fetchSpy.mock.calls.filter(([input, init]) => {
      return getRequestUrl(input).includes('/api/user/preferences') && init?.method === 'PUT';
    });
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('blocks sign-out on conflict and explicitly reloads the saved revision', async () => {
    let reads = 0;
    const logout = vi.fn(() => Promise.resolve(buildEvalJsonRes({ ok: true })));
    const serverProfile = { ...DEFAULT_PROFILE, householdSize: 7 };
    const save = vi.fn(() => Promise.resolve(buildEvalJsonRes({ error: 'PREFS_CONFLICT' }, 409)));
    vi.spyOn(globalThis, 'fetch').mockImplementation(createAuthFetchMock({
      onPrefsGet: async () => ++reads === 1
        ? buildEvalJsonRes({ profile: null })
        : buildEvalJsonRes({ profile: serverProfile }, 200, '"v2"'),
      onPrefsPut: save,
      onLogout: logout,
    }));
    render(<App />);
    const size = await screen.findByLabelText(/Household Size/i);
    fireEvent.change(size, { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    const reload = await screen.findByRole('button', { name: 'Reload saved preferences' });
    expect(screen.getByText(/still signed in/)).toHaveAttribute('role', 'alert');
    expect(logout).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ householdSize: 6 }));
    fireEvent.click(reload);
    await waitFor(() => expect(size).toHaveValue(7));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
  });

  it('surfaces visible retryable status notice when PUT /api/user/preferences fails', async () => {
    let putAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = getRequestUrl(input);
      if (url.includes('/api/auth/session')) {
        return Promise.resolve(buildEvalJsonRes({ authenticated: true, user: EVAL_USER }));
      }
      if (url.includes('/api/user/preferences')) {
        if (init?.method === 'PUT') {
          putAttempts += 1;
          if (putAttempts === 1) {
            return Promise.resolve(buildEvalJsonRes({ error: 'SAVE_FAILED' }, 500));
          }
          const parsed = typeof init.body === 'string' ? JSON.parse(init.body) : {};
          return Promise.resolve(buildEvalJsonRes({ profile: parsed.profile ?? null }, 200, '"v1"'));
        }
        return Promise.resolve(buildEvalJsonRes({ profile: null }));
      }
      if (url.includes('/api/auth/logout')) {
        return Promise.resolve(buildEvalJsonRes({ ok: true }));
      }
      return Promise.resolve(buildEvalJsonRes({ error: 'offline test mock' }, 503));
    });

    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByLabelText(/Household Size/i)).toBeInTheDocument();
    });
    expect(container.querySelector('svg polyline[stroke-dasharray="6 3"]')).not.toBeNull();
    expect(document.body.textContent ?? '').toContain('Ventilation Eligible Hours');

    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText(/Household Size/i), { target: { value: '5' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
    } finally {
      vi.useRealTimers();
    }

    const retryBtn = await screen.findByRole('button', { name: /Retry Save/i });
    expect(document.body.textContent ?? '').toContain('Could not save profile preferences.');

    fireEvent.click(retryBtn);
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Retry Save/i })).not.toBeInTheDocument();
    });
    expect(putAttempts).toBeGreaterThanOrEqual(2);
  });

  it('catches hook-level throws inside AuthenticatedWorkspace via outer ErrorBoundary', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    hookThrowState.shouldThrow = true;
    render(<AuthenticatedWorkspace authUser={EVAL_USER} onSignOut={vi.fn()} />);

    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toMatch(/recover|retry|view|display|समस्या/i);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
