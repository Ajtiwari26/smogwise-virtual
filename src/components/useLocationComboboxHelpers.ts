/**
 * Keyboard navigation, display formatting, and geolocation helpers for LocationSearchCombobox.
 */

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { isWithinIndiaCoords } from '../domain/cityPresets.js';
import { round4 } from '../domain/domainUtils.js';
import type { LocationSearchItem } from '../domain/types.js';

/** Interactive state for LocationSearchCombobox results and keyboard navigation. */
export interface SearchState {
  readonly results: readonly LocationSearchItem[];
  readonly isOpen: boolean;
  readonly isSearching: boolean;
  readonly activeIndex: number;
  readonly resultQuery: string | null;
}

/** Initial closed combobox state. */
export const INITIAL_SEARCH_STATE: SearchState = {
  results: [],
  isOpen: false,
  isSearching: false,
  activeIndex: -1,
  resultQuery: null,
};

/** Formats a locality name and optional state into a compact combobox label. */
export function formatDisplayLocation(loc: {
  readonly name: string;
  readonly state?: string;
}): string {
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

function resolveNextIndex(key: string, activeIndex: number, length: number): number | undefined {
  switch (key) {
    case 'ArrowDown':
      return (activeIndex + 1) % length;
    case 'ArrowUp':
      return activeIndex <= 0 ? length - 1 : activeIndex - 1;
    case 'Home':
      return 0;
    case 'End':
      return length - 1;
    default:
      return undefined;
  }
}

function computeOpenKeyState(
  key: string,
  state: SearchState,
): { readonly nextState?: SearchState; readonly selected?: LocationSearchItem } | undefined {
  if (key === 'Enter') {
    const chosen = state.results[state.activeIndex];
    return chosen !== undefined ? { selected: chosen } : undefined;
  }
  const nextIdx = resolveNextIndex(key, state.activeIndex, state.results.length);
  return nextIdx !== undefined ? { nextState: { ...state, activeIndex: nextIdx } } : undefined;
}

/** Computes next WAI-ARIA combobox keyboard transition when menu is already open or closed. */
export function computeNextKeyState(
  key: string,
  state: SearchState,
): { readonly nextState?: SearchState; readonly selected?: LocationSearchItem } | undefined {
  if (!state.isOpen) {
    return key === 'ArrowDown' && state.results.length > 0
      ? { nextState: { ...state, isOpen: true, activeIndex: 0 } }
      : undefined;
  }
  if (state.results.length === 0) {
    return undefined;
  }
  return computeOpenKeyState(key, state);
}

const GEO_TIMEOUT_MS = 8000;

/** Returns a geolocation handler that discards callbacks after unmount or a newer request. */
export function useGeolocationTrigger(
  isHindi: boolean,
  commitSelection: (item: LocationSearchItem) => void,
  setIsLocating: Dispatch<SetStateAction<boolean>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
): () => void {
  const mountedRef = useRef<boolean>(true);
  const geoReqIdRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      geoReqIdRef.current += 1;
    };
  }, []);

  return useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatusMessage(isHindi ? 'जियोलोकेशन उपलब्ध नहीं है।' : 'Geolocation is not supported.');
      return;
    }
    const reqId = ++geoReqIdRef.current;
    setIsLocating(true);
    setStatusMessage(isHindi ? 'आपकी लोकेशन जांची जा रही है...' : 'Detecting your location...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mountedRef.current || reqId !== geoReqIdRef.current) return;
        setIsLocating(false);
        const lat = round4(pos.coords.latitude);
        const lon = round4(pos.coords.longitude);
        if (!isWithinIndiaCoords(lat, lon)) {
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
        if (!mountedRef.current || reqId !== geoReqIdRef.current) return;
        setIsLocating(false);
        setStatusMessage(resolveGeoErrorMessage(err, isHindi));
      },
      { enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60000 },
    );
  }, [isHindi, commitSelection, setIsLocating, setStatusMessage]);
}
