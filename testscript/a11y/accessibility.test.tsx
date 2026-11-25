// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
