/**
 * Accessible WAI-ARIA 1.2 Indian location search combobox with 350ms debounced
 * /api/locations/search autocomplete and India-bounded geolocation trigger.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CustomLocation, LanguageCode, LocationSearchItem } from '../domain/types.js';
import { searchLocations } from '../services/apiClient.js';

const SEARCH_DEBOUNCE_MS = 350;
const GEO_TIMEOUT_MS = 8000;
const INDIA_LAT_MIN = 6.5;
const INDIA_LAT_MAX = 37.5;
const INDIA_LON_MIN = 68.0;
const INDIA_LON_MAX = 97.5;

/** Props for the LocationSearchCombobox component. */
export interface LocationSearchComboboxProps {
  readonly language: LanguageCode;
  readonly customLocation: CustomLocation | undefined;
  readonly onSelectLocation: (item: LocationSearchItem) => void;
}

interface SearchState {
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
  skipNextSearchRef: React.MutableRefObject<boolean>,
  setSearchState: React.Dispatch<React.SetStateAction<SearchState>>,
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
          if (!controller.signal.aborted) {
            setSearchState(INITIAL_SEARCH_STATE);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, skipNextSearchRef, setSearchState]);
}

function useGeolocationTrigger(
  isHindi: boolean,
  commitSelection: (item: LocationSearchItem) => void,
  setIsLocating: React.Dispatch<React.SetStateAction<boolean>>,
  setStatusMessage: React.Dispatch<React.SetStateAction<string>>,
): () => void {
  return useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setStatusMessage(
        isHindi
          ? 'इस ब्राउज़र में जियोलोकेशन उपलब्ध नहीं है।'
          : 'Geolocation is not supported in this browser.',
      );
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
          setStatusMessage(
            isHindi
              ? 'निर्देशांक भारत की सीमा से बाहर हैं। कृपया भारतीय शहर चुनें।'
              : 'Coordinates are outside India bounds. Please select an Indian city.',
          );
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

function computeNextKeyState(
  key: string,
  state: SearchState,
): { readonly nextState?: SearchState; readonly selected?: LocationSearchItem } | undefined {
  const { results, isOpen, activeIndex } = state;
  if (key === 'Escape') {
    return { nextState: { ...state, isOpen: false, activeIndex: -1 } };
  }
  if (!isOpen || results.length === 0) {
    return undefined;
  }
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

interface SuggestionListboxProps {
  readonly listboxId: string;
  readonly isHindi: boolean;
  readonly results: readonly LocationSearchItem[];
  readonly activeIndex: number;
  readonly onSelect: (item: LocationSearchItem) => void;
}

function SuggestionListbox({
  listboxId,
  isHindi,
  results,
  activeIndex,
  onSelect,
}: SuggestionListboxProps): ReactElement {
  const listCls =
    'absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border ' +
    'border-slate-300 bg-white py-1 shadow-lg';
  const btnCls =
    'flex w-full items-center justify-between px-3 py-2 text-left text-sm ' +
    'text-slate-900 hover:bg-emerald-50';

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={isHindi ? 'शहर सुझाव' : 'City suggestions'}
      className={listCls}
    >
      {results.map((item, idx) => {
        const selected = idx === activeIndex;
        return (
          <li
            key={item.id}
            id={`${listboxId}-${item.id}`}
            role="option"
            aria-selected={selected}
            className={selected ? 'bg-emerald-50' : 'bg-white'}
          >
            <button type="button" tabIndex={-1} onClick={() => onSelect(item)} className={btnCls}>
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-slate-600">{item.state}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ComboboxInputFieldProps {
  readonly inputId: string;
  readonly listboxId: string;
  readonly isHindi: boolean;
  readonly query: string;
  readonly searchState: SearchState;
  readonly onQueryChange: (value: string) => void;
  readonly onFocusInput: () => void;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  readonly onSelect: (item: LocationSearchItem) => void;
}

function ComboboxInputField({
  inputId,
  listboxId,
  isHindi,
  query,
  searchState,
  onQueryChange,
  onFocusInput,
  onKeyDown,
  onSelect,
}: ComboboxInputFieldProps): ReactElement {
  const activeOption =
    searchState.activeIndex >= 0 ? searchState.results[searchState.activeIndex] : undefined;
  const activeDescendantId =
    searchState.isOpen && activeOption !== undefined ? `${listboxId}-${activeOption.id}` : undefined;
  const inputCls =
    'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm ' +
    'text-slate-900 placeholder-slate-400 focus:border-emerald-700 focus:outline-none';

  return (
    <div className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={searchState.isOpen}
        aria-controls={listboxId}
        aria-autocomplete="list"
        {...(activeDescendantId !== undefined
          ? { 'aria-activedescendant': activeDescendantId }
          : {})}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onFocus={onFocusInput}
        onKeyDown={onKeyDown}
        placeholder={isHindi ? 'जैसे: इंदौर, भोपाल, नोएडा...' : 'e.g., Indore, Bhopal, Noida...'}
        className={inputCls}
      />
      {searchState.isOpen && searchState.results.length > 0 && (
        <SuggestionListbox
          listboxId={listboxId}
          isHindi={isHindi}
          results={searchState.results}
          activeIndex={searchState.activeIndex}
          onSelect={onSelect}
        />
      )}
    </div>
  );
}

function useOutsideClickClose(
  containerRef: React.RefObject<HTMLDivElement | null>,
  setSearchState: React.Dispatch<React.SetStateAction<SearchState>>,
): void {
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      const outside = containerRef.current !== null && target !== null
        && !containerRef.current.contains(target);
      if (outside) {
        setSearchState((prev) => ({ ...prev, isOpen: false, activeIndex: -1 }));
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [containerRef, setSearchState]);
}

interface ComboboxHeaderRowProps {
  readonly inputId: string;
  readonly isHindi: boolean;
  readonly isLocating: boolean;
  readonly onUseMyLocation: () => void;
}

function ComboboxHeaderRow({
  inputId,
  isHindi,
  isLocating,
  onUseMyLocation,
}: ComboboxHeaderRowProps): ReactElement {
  const geoBtnCls =
    'inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 ' +
    'px-2.5 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-60';

  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={inputId} className="block text-xs font-semibold text-slate-700">
        {isHindi ? 'कोई भी भारतीय शहर या इलाका खोजें' : 'Search Any Indian City or Locality'}
      </label>
      <button
        type="button"
        onClick={onUseMyLocation}
        aria-busy={isLocating}
        disabled={isLocating}
        className={geoBtnCls}
      >
        {isLocating
          ? (isHindi ? 'खोज रहे हैं...' : 'Locating...')
          : (isHindi ? 'मेरी लोकेशन' : 'Use My Location')}
      </button>
    </div>
  );
}

function useSyncedCustomLocation(
  customLocation: CustomLocation | undefined,
  skipNextSearchRef: React.MutableRefObject<boolean>,
  setQuery: React.Dispatch<React.SetStateAction<string>>,
  setSearchState: React.Dispatch<React.SetStateAction<SearchState>>,
): () => void {
  useEffect(() => {
    skipNextSearchRef.current = true;
    setQuery(customLocation !== undefined ? formatDisplayLocation(customLocation) : '');
    setSearchState(INITIAL_SEARCH_STATE);
  }, [customLocation, skipNextSearchRef, setQuery, setSearchState]);
  return useCallback(() => {
    setSearchState((prev) => (prev.results.length > 0 ? { ...prev, isOpen: true } : prev));
  }, [setSearchState]);
}

interface ComboboxStatusFooterProps {
  readonly isHindi: boolean;
  readonly isSearching: boolean;
  readonly statusMessage: string;
}

function ComboboxStatusFooter({
  isHindi,
  isSearching,
  statusMessage,
}: ComboboxStatusFooterProps): ReactElement {
  return (
    <>
      {isSearching && (
        <p className="text-xs text-slate-600">
          {isHindi ? 'स्थान खोजे जा रहे हैं...' : 'Searching Indian locations...'}
        </p>
      )}
      <p role="status" aria-live="polite" className="min-h-[1rem] text-xs text-slate-700">
        {statusMessage}
      </p>
    </>
  );
}

function useLocationKeyHandler(
  searchState: SearchState,
  setSearchState: React.Dispatch<React.SetStateAction<SearchState>>,
  commitSelection: (item: LocationSearchItem) => void,
): (event: React.KeyboardEvent<HTMLInputElement>) => void {
  return useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const outcome = computeNextKeyState(event.key, searchState);
      if (outcome === undefined) return;
      event.preventDefault();
      if (outcome.nextState !== undefined) setSearchState(outcome.nextState);
      if (outcome.selected !== undefined) commitSelection(outcome.selected);
    },
    [searchState, setSearchState, commitSelection],
  );
}

/**
 * Pan-India city/locality autocomplete combobox + GPS location button.
 */
export function LocationSearchCombobox({
  language,
  customLocation,
  onSelectLocation,
}: LocationSearchComboboxProps): ReactElement {
  const isHindi = language === 'hi';
  const inputId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const skipNextSearchRef = useRef<boolean>(false);
  const [query, setQuery] = useState<string>(() =>
    customLocation !== undefined ? formatDisplayLocation(customLocation) : '',
  );
  const [searchState, setSearchState] = useState<SearchState>(INITIAL_SEARCH_STATE);
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const handleFocusInput = useSyncedCustomLocation(
    customLocation,
    skipNextSearchRef,
    setQuery,
    setSearchState,
  );
  useDebouncedLocationSearch(query, skipNextSearchRef, setSearchState);
  useOutsideClickClose(containerRef, setSearchState);

  const commitSelection = useCallback(
    (item: LocationSearchItem) => {
      skipNextSearchRef.current = true;
      setQuery(`${item.name}, ${item.state}`);
      setSearchState(INITIAL_SEARCH_STATE);
      setStatusMessage(
        isHindi ? `${item.name}, ${item.state} चुना गया` : `Selected ${item.name}, ${item.state}`,
      );
      onSelectLocation(item);
    },
    [isHindi, onSelectLocation],
  );

  const handleInputKeyDown = useLocationKeyHandler(searchState, setSearchState, commitSelection);

  const handleUseMyLocation = useGeolocationTrigger(
    isHindi,
    commitSelection,
    setIsLocating,
    setStatusMessage,
  );

  return (
    <div ref={containerRef} className="relative space-y-2">
      <ComboboxHeaderRow
        inputId={inputId}
        isHindi={isHindi}
        isLocating={isLocating}
        onUseMyLocation={handleUseMyLocation}
      />
      <ComboboxInputField
        inputId={inputId}
        listboxId={listboxId}
        isHindi={isHindi}
        query={query}
        searchState={searchState}
        onQueryChange={setQuery}
        onFocusInput={handleFocusInput}
        onKeyDown={handleInputKeyDown}
        onSelect={commitSelection}
      />
      <ComboboxStatusFooter
        isHindi={isHindi}
        isSearching={searchState.isSearching}
        statusMessage={statusMessage}
      />
    </div>
  );
}
