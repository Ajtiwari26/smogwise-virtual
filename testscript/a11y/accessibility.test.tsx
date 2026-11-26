// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App.js';

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
    expect(container.querySelector('main#main-content')).not.toBeNull();
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
      expect(targetId).toBeTruthy();
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

describe('App authenticated session lifecycle & landmarks', () => {
  it('logs in via 1-Click Evaluator Access, renders authenticated dashboard landmarks, and signs out cleanly', async () => {
    const evalUser = {
      id: 'eval-family',
      email: 'family.eval@smogwise.in',
      name: 'Delhi Family',
      personaId: 'young_family',
      defaultLang: 'en',
      defaultCityId: 'delhi_anand_vihar',
    };
    const jsonRes = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });

    vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/auth/session')) {
        return Promise.resolve(jsonRes({ error: 'UNAUTHENTICATED' }, 401));
      }
      if (url.includes('/api/auth/login')) {
        return Promise.resolve(jsonRes({ user: evalUser }));
      }
      if (url.includes('/api/user/preferences')) {
        return Promise.resolve(jsonRes({ profile: null }));
      }
      if (url.includes('/api/auth/logout')) {
        return Promise.resolve(jsonRes({ ok: true }));
      }
      return Promise.resolve(jsonRes({ error: 'offline test mock' }, 503));
    });

    const { container } = render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delhi Family/i })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole('button', { name: /Delhi Family/i }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Sign Out/i })).not.toBeNull();
    });
    expect(container.querySelector('#impact')).not.toBeNull();
    expect(document.body.textContent ?? '').toContain('Direct Health & Emissions Impact');

    fireEvent.click(screen.getByRole('button', { name: /Sign Out/i }));
    await waitFor(() => {
      expect(container.querySelector('#gateway-login')).not.toBeNull();
    });
    expect(container.querySelector('#impact')).toBeNull();
  });
});
