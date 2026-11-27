/**
 * State, debounced search, India-bounded geolocation & keyboard hooks for LocationSearchCombobox.
 */

import type { Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomLocation, LocationSearchItem } from '../domain/types.js';
import { searchLocations } from '../services/apiClient.js';
import {
  computeNextKeyState,
  formatDisplayLocation,
  INITIAL_SEARCH_STATE,
  useGeolocationTrigger,
  type SearchState,
} from './useLocationComboboxHelpers.js';

/** Re-exported search state interface for location combobox hooks. */
export type { SearchState } from './useLocationComboboxHelpers.js';

const SEARCH_DEBOUNCE_MS = 350;

function runDebouncedQuery(
  query: string,
  isHindi: boolean,
  signal: AbortSignal,
  canOpenRef: RefObject<boolean>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
): void {
  void searchLocations(extractCitySearchTerm(query), signal)
    .then((items) => {
      if (signal.aborted) return;
      const isOpen = canOpenRef.current && items.length > 0;
      setSearchState({
        results: items,
        isOpen,
        isSearching: false,
        activeIndex: isOpen ? 0 : -1,
        resultQuery: query,
      });
      if (items.length === 0) {
        setStatusMessage(
          isHindi
            ? 'कोई मेल खाने वाला भारतीय शहर नहीं मिला।'
            : 'No matching Indian locations found.',
        );
      }
    })
    .catch((err: unknown) => {
      void err;
      if (signal.aborted) return;
      setSearchState(INITIAL_SEARCH_STATE);
      setStatusMessage(
        isHindi ? 'स्थान खोज विफल रही। पुनः प्रयास करें।' : 'Location search failed. Please retry.',
      );
    });
}

function extractCitySearchTerm(rawQuery: string): string {
  const trimmed = rawQuery.trim();
  const commaIdx = trimmed.indexOf(',');
  return commaIdx === -1 ? trimmed : trimmed.slice(0, commaIdx).trim();
}

function useDebouncedLocationSearch(
  query: string,
  isHindi: boolean,
  suppressedQueryRef: MutableRefObject<string | null>,
  canOpenRef: RefObject<boolean>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
): void {
  const isHindiRef = useRef<boolean>(isHindi);
  useEffect(() => {
    isHindiRef.current = isHindi;
  }, [isHindi]);

  useEffect(() => {
    if (suppressedQueryRef.current !== null && query === suppressedQueryRef.current) {
      suppressedQueryRef.current = null;
      return undefined;
    }
    suppressedQueryRef.current = null;
    if (extractCitySearchTerm(query).length < 2) {
      setSearchState(INITIAL_SEARCH_STATE);
      return undefined;
    }
    const controller = new AbortController();
    setSearchState({ ...INITIAL_SEARCH_STATE, isSearching: true });
    const timer = setTimeout(() => {
      runDebouncedQuery(
        query,
        isHindiRef.current,
        controller.signal,
        canOpenRef,
        setSearchState,
        setStatusMessage,
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, suppressedQueryRef, canOpenRef, setSearchState, setStatusMessage]);
}

function useOutsideDismiss(
  containerRef: RefObject<HTMLDivElement | null>,
  closeSuggestions: () => void,
): void {
  useEffect(() => {
    const onDocDown = (event: MouseEvent): void => {
      const target = event.target;
      const el = containerRef.current;
      if (el !== null && target instanceof Node && !el.contains(target)) {
        closeSuggestions();
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [containerRef, closeSuggestions]);
}

/** Return contract for the useLocationCombobox controller hook. */
interface LocationComboboxController {
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly query: string;
  readonly searchState: SearchState;
  readonly isLocating: boolean;
  readonly statusMessage: string;
  readonly changeQuery: (value: string) => void;
  readonly closeSuggestions: () => void;
  readonly handleFocusInput: () => void;
  readonly handleInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly handleUseMyLocation: () => void;
  readonly commitSelection: (item: LocationSearchItem) => void;
}

function useSyncCustomLocation(
  customLocation: CustomLocation | undefined,
  suppressedQueryRef: MutableRefObject<string | null>,
  setQuery: Dispatch<SetStateAction<string>>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
): void {
  useEffect(() => {
    const formatted = customLocation !== undefined ? formatDisplayLocation(customLocation) : '';
    suppressedQueryRef.current = formatted;
    setQuery(formatted);
    setSearchState(INITIAL_SEARCH_STATE);
  }, [customLocation, suppressedQueryRef, setQuery, setSearchState]);
}

function useSuggestionControls(
  query: string,
  setQuery: Dispatch<SetStateAction<string>>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
) {
  const canOpenRef = useRef(true);
  const closeSuggestions = useCallback(() => {
    canOpenRef.current = false;
    setSearchState((prev) => ({ ...prev, isOpen: false, activeIndex: -1 }));
  }, [setSearchState]);
  const handleFocusInput = useCallback(() => {
    canOpenRef.current = true;
    setSearchState((prev) =>
      prev.resultQuery === query && prev.results.length > 0 ? { ...prev, isOpen: true } : prev,
    );
  }, [query, setSearchState]);
  const changeQuery = useCallback((value: string) => {
    canOpenRef.current = true;
    setQuery(value);
    setStatusMessage('');
  }, [setQuery, setStatusMessage]);
  return { canOpenRef, changeQuery, closeSuggestions, handleFocusInput };
}

function useSuggestionKeyboard(
  query: string,
  searchState: SearchState,
  closeSuggestions: () => void,
  commitSelection: (item: LocationSearchItem) => void,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
) {
  return useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') {
      closeSuggestions();
      return;
    }
    if (event.key === 'Escape') {
      closeSuggestions();
      event.preventDefault();
      return;
    }
    if (searchState.resultQuery !== query) return;
    const outcome = computeNextKeyState(event.key, searchState);
    if (outcome === undefined) return;
    event.preventDefault();
    if (outcome.nextState !== undefined) setSearchState(outcome.nextState);
    if (outcome.selected !== undefined) commitSelection(outcome.selected);
  }, [query, searchState, closeSuggestions, commitSelection, setSearchState]);
}

/** Manages WAI-ARIA 1.2 combobox search, keyboard navigation, and India geolocation. */
export function useLocationCombobox(
  isHindi: boolean,
  customLocation: CustomLocation | undefined,
  onSelectLocation: (item: LocationSearchItem) => void,
): LocationComboboxController {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialDisplay = customLocation !== undefined ? formatDisplayLocation(customLocation) : '';
  const suppressedQueryRef = useRef<string | null>(initialDisplay);
  const [query, setQuery] = useState<string>(initialDisplay);
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const { canOpenRef, ...controls } = useSuggestionControls(
    query, setQuery, setSearchState, setStatusMessage,
  );
  useSyncCustomLocation(customLocation, suppressedQueryRef, setQuery, setSearchState);
  useDebouncedLocationSearch(
    query, isHindi, suppressedQueryRef, canOpenRef, setSearchState, setStatusMessage,
  );
  const { closeSuggestions } = controls;
  useOutsideDismiss(containerRef, closeSuggestions);

  const commitSelection = useCallback((item: LocationSearchItem) => {
    const display = formatDisplayLocation(item);
    suppressedQueryRef.current = display;
    setQuery(display);
    setSearchState(INITIAL_SEARCH_STATE);
    setStatusMessage(isHindi ? `${display} चुना गया` : `Selected ${display}`);
    onSelectLocation(item);
  }, [isHindi, onSelectLocation]);

  const handleInputKeyDown = useSuggestionKeyboard(
    query, searchState, closeSuggestions, commitSelection, setSearchState,
  );

  const handleUseMyLocation = useGeolocationTrigger(
    isHindi,
    commitSelection,
    setIsLocating,
    setStatusMessage,
  );

  return {
    containerRef,
    query,
    searchState,
    isLocating,
    statusMessage,
    ...controls,
    handleInputKeyDown,
    handleUseMyLocation,
    commitSelection,
  };
}
