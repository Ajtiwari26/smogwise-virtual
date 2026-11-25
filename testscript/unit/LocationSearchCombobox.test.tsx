// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocationSearchCombobox } from '../../src/components/LocationSearchCombobox.js';
import { CITY_PRESETS } from '../../src/domain/cityPresets.js';
import type { LocationSearchItem } from '../../src/domain/types.js';
import * as apiClient from '../../src/services/apiClient.js';

const jaipurResults: readonly LocationSearchItem[] = [
  {
    id: 'jaipur-rj',
    name: 'Jaipur',
    state: 'Rajasthan',
    lat: 26.9124,
    lon: 75.7873,
  },
  {
    id: 'jaipur-malviya',
    name: 'Malviya Nagar, Jaipur',
    state: 'Rajasthan',
    lat: 26.8549,
    lon: 75.8243,
  },
];

type GeoImpl = (
  success: PositionCallback,
  error?: PositionErrorCallback,
) => void;

function mockGeolocation(impl: GeoImpl): void {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: {
      getCurrentPosition: vi.fn(impl),
    },
  });
}

describe('LocationSearchCombobox debounce and autocomplete', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('debounces typing by 350ms before calling searchLocations and renders listbox', async () => {
    const searchSpy = vi.spyOn(apiClient, 'searchLocations').mockResolvedValue(jaipurResults);
    const onSelectLocation = vi.fn();

    render(
      <LocationSearchCombobox
        language="en"
        customLocation={undefined}
        onSelectLocation={onSelectLocation}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Jaipur' } });
    expect(searchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(349);
    });
    expect(searchSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(searchSpy).toHaveBeenCalledWith('Jaipur', expect.any(AbortSignal));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });
});

describe('LocationSearchCombobox keyboard navigation and dismissal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('supports ArrowDown, ArrowUp, Enter selection, Escape close, and outside mouseDown', async () => {
    vi.spyOn(apiClient, 'searchLocations').mockResolvedValue(jaipurResults);
    const onSelectLocation = vi.fn();

    render(
      <div>
        <button type="button">Outside</button>
        <LocationSearchCombobox
          language="en"
          customLocation={undefined}
          onSelectLocation={onSelectLocation}
        />
      </div>,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Jaipur' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectLocation).toHaveBeenCalledWith(jaipurResults[0]);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('LocationSearchCombobox End/Home navigation, pending status, and city presets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('supports End and Home key navigation inside listbox', async () => {
    vi.spyOn(apiClient, 'searchLocations').mockResolvedValue(jaipurResults);

    render(
      <LocationSearchCombobox
        language="en"
        customLocation={undefined}
        onSelectLocation={vi.fn()}
      />,
    );

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Jaipur' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'End' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('renders Searching Indian locations... inside role=status while searchLocations is pending', async () => {
    let resolveSearch!: (items: readonly LocationSearchItem[]) => void;
    vi.spyOn(apiClient, 'searchLocations').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSearch = resolve;
        }),
    );

    render(
      <LocationSearchCombobox
        language="en"
        customLocation={undefined}
        onSelectLocation={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Jaipur' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    const statusEls = screen.getAllByRole('status');
    expect(statusEls.some((el) => el.textContent?.includes('Searching Indian locations...'))).toBe(
      true,
    );

    await act(async () => {
      resolveSearch(jaipurResults);
    });
  });

  it('verifies CITY_PRESETS has no lahore_gulberg or salt_lake_city', () => {
    const presetIds = CITY_PRESETS.map((preset) => preset.id);
    expect(presetIds).not.toContain('lahore_gulberg');
    expect(presetIds).not.toContain('salt_lake_city');
  });
});

describe('LocationSearchCombobox geolocation handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('handles in-India geolocation, out-of-India rejection, and permission denied status', () => {
    const onSelectLocation = vi.fn();
    mockGeolocation((success) => {
      success({
        coords: { latitude: 26.91, longitude: 75.79 },
      } as GeolocationPosition);
    });

    render(
      <LocationSearchCombobox
        language="en"
        customLocation={undefined}
        onSelectLocation={onSelectLocation}
      />,
    );

    const geoBtn = screen.getByRole('button', { name: 'Use My Location' });
    fireEvent.click(geoBtn);
    expect(onSelectLocation).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 26.91, lon: 75.79 }),
    );

    mockGeolocation((success) => {
      success({
        coords: { latitude: 51.5, longitude: -0.1 },
      } as GeolocationPosition);
    });
    fireEvent.click(geoBtn);
    expect(onSelectLocation).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).not.toBe('');

    mockGeolocation((_success, error) => {
      error?.({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError);
    });
    fireEvent.click(geoBtn);
    expect(screen.getByRole('status').textContent).not.toBe('');
  });
});
