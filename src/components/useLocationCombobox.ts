/**
 * State, debounced search, India-bounded geolocation & keyboard hooks for LocationSearchCombobox.
 */

import type { Dispatch, KeyboardEvent, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CustomLocation, LocationSearchItem } from '../domain/types.js';
import {
  computeNextKeyState,
  extractCitySearchTerm,
  formatDisplayLocation,
  INITIAL_SEARCH_STATE,
  runDebouncedQuery,
  useGeolocationTrigger,
  useOutsideDismiss,
  type SearchState,
} from './useLocationComboboxHelpers.js';

/** Re-exported search state interface for location combobox hooks. */
export type { SearchState } from './useLocationComboboxHelpers.js';

const SEARCH_DEBOUNCE_MS = 350;

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
        query, isHindiRef.current, controller.signal, canOpenRef, setSearchState, setStatusMessage,
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, suppressedQueryRef, canOpenRef, setSearchState, setStatusMessage]);
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
  presetSelectionRevision: number | string | undefined,
  customLocation: CustomLocation | undefined,
  suppressedQueryRef: MutableRefObject<string | null>,
  selectionEpochRef: MutableRefObject<number>,
  setQuery: Dispatch<SetStateAction<string>>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
  setIsLocating: Dispatch<SetStateAction<boolean>>,
): void {
  useLayoutEffect(() => {
    selectionEpochRef.current += 1;
    setIsLocating(false);
    const formatted = customLocation !== undefined ? formatDisplayLocation(customLocation) : '';
    suppressedQueryRef.current = formatted;
    setQuery(formatted);
    setSearchState(INITIAL_SEARCH_STATE);
  }, [
    customLocation,
    presetSelectionRevision,
    suppressedQueryRef,
    selectionEpochRef,
    setQuery,
    setSearchState,
    setIsLocating,
  ]);
}

function useSuggestionControls(
  query: string,
  selectionEpochRef: MutableRefObject<number>,
  setQuery: Dispatch<SetStateAction<string>>,
  setSearchState: Dispatch<SetStateAction<SearchState>>,
  setStatusMessage: Dispatch<SetStateAction<string>>,
  setIsLocating: Dispatch<SetStateAction<boolean>>,
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
    selectionEpochRef.current += 1;
    setIsLocating(false);
    canOpenRef.current = true;
    setQuery(value);
    setStatusMessage('');
  }, [selectionEpochRef, setIsLocating, setQuery, setStatusMessage]);
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
  presetSelectionRevision?: number | string,
): LocationComboboxController {
  const containerRef = useRef<HTMLDivElement>(null);
  const initial = customLocation !== undefined ? formatDisplayLocation(customLocation) : '';
  const suppressedQueryRef = useRef<string | null>(initial);
  const selectionEpochRef = useRef<number>(0);
  const [query, setQuery] = useState<string>(initial);
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const { canOpenRef, ...controls } = useSuggestionControls(
    query, selectionEpochRef, setQuery, setSearchState, setStatusMessage, setIsLocating,
  );
  useSyncCustomLocation(
    presetSelectionRevision, customLocation, suppressedQueryRef, selectionEpochRef,
    setQuery, setSearchState, setIsLocating,
  );
  useDebouncedLocationSearch(
    query, isHindi, suppressedQueryRef, canOpenRef, setSearchState, setStatusMessage,
  );
  useOutsideDismiss(containerRef, controls.closeSuggestions);

  const commitSelection = useCallback((item: LocationSearchItem) => {
    selectionEpochRef.current += 1;
    setIsLocating(false);
    const display = formatDisplayLocation(item);
    suppressedQueryRef.current = display;
    setQuery(display);
    setSearchState(INITIAL_SEARCH_STATE);
    setStatusMessage(isHindi ? `${display} चुना गया` : `Selected ${display}`);
    onSelectLocation(item);
  }, [isHindi, onSelectLocation]);

  const handleInputKeyDown = useSuggestionKeyboard(
    query, searchState, controls.closeSuggestions, commitSelection, setSearchState,
  );
  const handleUseMyLocation = useGeolocationTrigger(
    isHindi, commitSelection, setIsLocating, setStatusMessage, selectionEpochRef,
  );
  return {
    containerRef, query, searchState, isLocating, statusMessage, ...controls,
    handleInputKeyDown, handleUseMyLocation, commitSelection,
  };
}
