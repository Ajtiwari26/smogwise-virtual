/**
 * Accessible WAI-ARIA 1.2 Indian location search combobox with 350ms debounced
 * /api/locations/search autocomplete and India-bounded geolocation trigger.
 */

import type { KeyboardEvent, ReactElement } from 'react';
import { useEffect, useId, useRef } from 'react';
import type { CustomLocation, LanguageCode, LocationSearchItem } from '../domain/types.js';
import { type SearchState, useLocationCombobox } from './useLocationCombobox.js';

/** Props for the LocationSearchCombobox component. */
export interface LocationSearchComboboxProps {
  readonly language: LanguageCode;
  readonly customLocation: CustomLocation | undefined;
  readonly onSelectLocation: (item: LocationSearchItem) => void;
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
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeOptionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex]);

  const listCls =
    'absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border ' +
    'border-slate-500 bg-white py-1 shadow-lg';
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
        const focusCls = 'bg-emerald-50 ring-2 ring-inset ring-teal-700';
        const optCls = `${btnCls} ${selected ? focusCls : 'bg-white'}`;
        return (
          <li key={item.id} role="none">
            <button
              ref={selected ? activeOptionRef : null}
              type="button"
              id={`${listboxId}-${item.id}`}
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              onClick={() => onSelect(item)}
              className={optCls}
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-xs text-slate-700">{item.state}</span>
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
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpen = searchState.isOpen && searchState.results.length > 0;
  const activeOption = searchState.results[searchState.activeIndex];
  const activeDescendantId =
    isOpen && activeOption !== undefined ? `${listboxId}-${activeOption.id}` : undefined;
  const inputCls =
    'w-full rounded-lg border border-slate-500 bg-white px-3 py-2 text-sm text-slate-900 ' +
    'placeholder-slate-600 focus:border-emerald-700 focus:outline-none ' +
    'focus-visible:ring-2 focus-visible:ring-teal-700';

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
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
      {isOpen && (
        <SuggestionListbox
          listboxId={listboxId}
          isHindi={isHindi}
          results={searchState.results}
          activeIndex={searchState.activeIndex}
          onSelect={(item) => {
            inputRef.current?.focus();
            onSelect(item);
          }}
        />
      )}
    </div>
  );
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
    'inline-flex items-center gap-1 rounded-md border border-slate-500 bg-slate-50 ' +
    'px-2.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 disabled:opacity-60';

  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={inputId} className="block text-xs font-semibold text-slate-800">
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

/** Pan-India city/locality autocomplete combobox + GPS location button. */
export function LocationSearchCombobox({
  language,
  customLocation,
  onSelectLocation,
}: LocationSearchComboboxProps): ReactElement {
  const isHindi = language === 'hi';
  const inputId = useId();
  const listboxId = useId();
  const ctrl = useLocationCombobox(isHindi, customLocation, onSelectLocation);

  return (
    <div
      ref={ctrl.containerRef}
      className="relative space-y-2"
      onBlur={({ currentTarget, relatedTarget }) => {
        if (!(relatedTarget instanceof Node) || !currentTarget.contains(relatedTarget)) {
          ctrl.closeSuggestions();
        }
      }}
    >
      <ComboboxHeaderRow
        inputId={inputId}
        isHindi={isHindi}
        isLocating={ctrl.isLocating}
        onUseMyLocation={ctrl.handleUseMyLocation}
      />
      <ComboboxInputField
        inputId={inputId}
        listboxId={listboxId}
        isHindi={isHindi}
        query={ctrl.query}
        searchState={ctrl.searchState}
        onQueryChange={ctrl.changeQuery}
        onFocusInput={ctrl.handleFocusInput}
        onKeyDown={ctrl.handleInputKeyDown}
        onSelect={ctrl.commitSelection}
      />
      {ctrl.searchState.isSearching && (
        <p role="status" aria-live="polite" className="text-xs text-slate-700">
          {isHindi ? 'स्थान खोजे जा रहे हैं...' : 'Searching Indian locations...'}
        </p>
      )}
      <p role="status" aria-live="polite" className="min-h-[1rem] text-xs text-slate-700">
        {ctrl.statusMessage}
      </p>
    </div>
  );
}
