/**
 * State, debounced search, India-bounded geolocation, and keyboard hooks.
 */

import type {
  Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomLocation, LocationSearchItem } from '../domain/types.js';
import { searchLocations } from '../services/apiClient.js';

const SEARCH_DEBOUNCE_MS = 350;
const GEO_TIMEOUT_MS = 8000;
const INDIA_LAT_MIN = 6.5;
const INDIA_LAT_MAX = 37.5;
const INDIA_LON_MIN = 68.0;
const INDIA_LON_MAX = 97.5;

export interface SearchState {
  readonly results: readonly LocationSearchItem[];
  readonly isOpen: boolean;
  readonly isSearching: boolean;
  readonly activeIndex: number;
}

const INITIAL_SEARCH_STATE: SearchState = {
  results: [],
  isOpen: false,
  isSearching: false,
  activeIndex: -1,
};

function isWithinIndiaBounds(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat)
    && Number.isFinite(lon)
    && lat >= INDIA_LAT_MIN
    && lat <= INDIA_LAT_MAX
    && lon >= INDIA_LON_MIN
    && lon <= INDIA_LON_MAX
  );
}

function formatDisplayLocation(loc: CustomLocation): string {
  const state = loc.state?.trim() ?? '';
  return state.length > 0 ? `${loc.name}, ${state}` : loc.name;
}

function resolveGeoErrorMessage(err: GeolocationPositionError, isHindi: boolean): string {
  if (err.code === err.PERMISSION_DENIED) {
    return isHindi
      ? 'लोकेशन अनुमति अस्वीकार कर दी गई। नीचे से शहर खोजें या चुनें।'
      : 'Location permission denied. Search or select a city preset below.';
  }
  if (err.code === err.TIMEOUT) {
    return isHindi
      ? 'जीपीएस लोकेशन में समय समाप्त हो गया। कृपया शहर खोजें।'
      : 'Location request timed out. Please search for your city.';
  }
  return isHindi
    ? 'लोकेशन प्राप्त नहीं हो सकी। कृपया शहर का नाम टाइप करें।'
    : 'Unable to determine your location. Please search by city name.';
}

function useDebouncedLocationSearch(
  query: string,
  skipNextSearchRef: MutableRefObject<boolean>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
): void {
  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchState(INITIAL_SEARCH_STATE);
      return;
    }
    const controller = new AbortController();
    setSearchState((prev) => ({ ...prev, isSearching: true }));
    const timer = setTimeout(() => {
      void searchLocations(trimmed, controller.signal)
        .then((items) => {
          setSearchState({
            results: items,
            isOpen: items.length > 0,
            isSearching: false,
            activeIndex: items.length > 0 ? 0 : -1,
          });
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchState(INITIAL_SEARCH_STATE);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, skipNextSearchRef, setSearchState]);
}

function computeNextKeyState(
  key: string,
  state: SearchState,
): { readonly nextState?: SearchState; readonly selected?: LocationSearchItem } | undefined {
  const { results, isOpen, activeIndex } = state;
  if (key === 'Escape') return { nextState: { ...state, isOpen: false, activeIndex: -1 } };
  if (!isOpen || results.length === 0) return undefined;
  if (key === 'ArrowDown') {
    return { nextState: { ...state, activeIndex: (activeIndex + 1) % results.length } };
  }
  if (key === 'ArrowUp') {
    const next = (activeIndex - 1 + results.length) % results.length;
    return { nextState: { ...state, activeIndex: next } };
  }
  if (key === 'Enter' && activeIndex >= 0 && activeIndex < results.length) {
    const chosen = results[activeIndex];
    return chosen !== undefined ? { selected: chosen } : undefined;
  }
  return undefined;
}

function useGeolocationTrigger(
  isHindi: boolean,
  commitSelection: (item: LocationSearchItem) => void,
  setIsLocating: Dispatch<SetStateAction<boolean>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
): () => void {
  return useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatusMessage(isHindi ? 'जियोलोकेशन उपलब्ध नहीं है।' : 'Geolocation is not supported.');
      return;
    }
    setIsLocating(true);
    setStatusMessage(isHindi ? 'आपकी लोकेशन जांची जा रही है...' : 'Detecting your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const lat = Math.round(pos.coords.latitude * 10000) / 10000;
        const lon = Math.round(pos.coords.longitude * 10000) / 10000;
        if (!isWithinIndiaBounds(lat, lon)) {
          setStatusMessage(isHindi ? 'निर्देशांक भारत से बाहर हैं।' : 'Coordinates outside India.');
          return;
        }
        commitSelection({
          id: `gps_${String(lat)}_${String(lon)}`,
          name: isHindi ? 'मेरी वर्तमान लोकेशन' : 'Current Location',
          state: 'India',
          lat,
          lon,
        });
      },
      (err) => {
        setIsLocating(false);
        setStatusMessage(resolveGeoErrorMessage(err, isHindi));
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 },
    );
  }, [isHindi, commitSelection, setIsLocating, setStatusMessage]);
}

export interface LocationComboboxController {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly query: string;
  readonly searchState: SearchState;
  readonly isLocating: boolean;
  readonly statusMessage: string;
  readonly setQuery: Dispatch<SetStateAction<string>>;
  readonly handleFocusInput: () => void;
  readonly handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly handleUseMyLocation: () => void;
  readonly commitSelection: (item: LocationSearchItem) => void;
}

export function useLocationCombobox(
  isHindi: boolean,
  customLocation: CustomLocation | undefined,
  onSelectLocation: (item: LocationSearchItem) => void,
): LocationComboboxController {
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextSearchRef = useRef<boolean>(false);
  const [query, setQuery] = useState<string>(() =>
    customLocation !== undefined ? formatDisplayLocation(customLocation) : '',
  );
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  useEffect(() => {
    skipNextSearchRef.current = true;
    setQuery(customLocation !== undefined ? formatDisplayLocation(customLocation) : '');
    setSearchState(INITIAL_SEARCH_STATE);
  }, [customLocation]);
  useDebouncedLocationSearch(query, skipNextSearchRef, setSearchState);
  useEffect(() => {
    const onDocDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      const el = containerRef.current;
      if (el !== null && target !== null && !el.contains(target)) {
        setSearchState((prev) => ({ ...prev, isOpen: false, activeIndex: -1 }));
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);

  const handleFocusInput = useCallback(() => {
    setSearchState((prev) => (prev.results.length > 0 ? { ...prev, isOpen: true } : prev));
  }, []);
  const commitSelection = useCallback((item: LocationSearchItem) => {
    skipNextSearchRef.current = true;
    setQuery(`${item.name}, ${item.state}`);
    setSearchState(INITIAL_SEARCH_STATE);
    setStatusMessage(isHindi ? `${item.name}, ${item.state} चुना गया` : `Selected ${item.name}, ${item.state}`);
    onSelectLocation(item);
  }, [isHindi, onSelectLocation]);
  const handleInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    const outcome = computeNextKeyState(event.key, searchState);
    if (outcome === undefined) return;
    event.preventDefault();
    if (outcome.nextState !== undefined) setSearchState(outcome.nextState);
    if (outcome.selected !== undefined) commitSelection(outcome.selected);
  }, [searchState, commitSelection]);
  const handleUseMyLocation = useGeolocationTrigger(
    isHindi, commitSelection, setIsLocating, setStatusMessage,
  );

  return {
    containerRef, query, searchState, isLocating, statusMessage,
    setQuery, handleFocusInput, handleInputKeyDown, handleUseMyLocation, commitSelection,
  };
}
