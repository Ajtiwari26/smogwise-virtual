/**
 * Interactive header control group: city picker, language switcher, and session actions.
 */

import React from 'react';
import { CITY_PRESETS } from '../domain/cityPresets.js';
import type { CityPreset, LanguageCode } from '../domain/types.js';
import type { AuthUser } from '../services/apiClient.js';

const BTN_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700';

const LanguageSwitcher: React.FC<{
  readonly language: LanguageCode;
  readonly onChange: (lang: LanguageCode) => void;
  readonly disabled: boolean;
}> = React.memo(function LanguageSwitcher({ language, onChange, disabled }) {
  const isHi = language === 'hi';
  return (
    <div
      role="group"
      aria-label={isHi ? 'भाषा चुनें' : 'Language selector'}
      className="inline-flex rounded-md border border-slate-500 bg-slate-100 p-0.5"
    >
      <button
        type="button"
        lang="en"
        disabled={disabled}
        aria-pressed={language === 'en'}
        onClick={() => onChange('en')}
        className={`rounded px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_RING} ${
          language === 'en' ? 'bg-slate-900 text-white' : 'text-slate-900 hover:bg-slate-200'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        lang="hi"
        disabled={disabled}
        aria-pressed={language === 'hi'}
        onClick={() => onChange('hi')}
        className={`rounded px-2.5 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${BTN_RING} ${
          language === 'hi' ? 'bg-slate-900 text-white' : 'text-slate-900 hover:bg-slate-200'
        }`}
      >
        हिन्दी
      </button>
    </div>
  );
});

const CityPicker: React.FC<{
  readonly city: CityPreset;
  readonly isHi: boolean;
  readonly onCityChange: (cityId: string) => void;
  readonly disabled: boolean;
}> = React.memo(function CityPicker({ city, isHi, onCityChange, disabled }) {
  const isCustomCity = !CITY_PRESETS.some((p) => p.id === city.id);
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="header-city-select" className="text-xs font-semibold text-slate-800">
        {isHi ? 'शहर' : 'City'}
      </label>
      <select
        id="header-city-select"
        value={city.id}
        disabled={disabled}
        onChange={(e) => onCityChange(e.target.value)}
        className={`rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 ${BTN_RING}`}
      >
        {isCustomCity && (
          <option value={city.id}>{isHi ? city.nameHi : city.name}</option>
        )}
        {CITY_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {isHi ? preset.nameHi : preset.name}
          </option>
        ))}
      </select>
    </div>
  );
});

const SessionControls: React.FC<{
  readonly authUser: AuthUser;
  readonly isHi: boolean;
  readonly onSignOut: () => void;
  readonly disabled: boolean;
}> = React.memo(function SessionControls({ authUser, isHi, onSignOut, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <span className="rounded-full border border-slate-400 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-900">
        {authUser.name}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onSignOut}
        className={`rounded-md border border-slate-500 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 ${BTN_RING}`}
      >
        {isHi ? 'लॉग आउट' : 'Sign Out'}
      </button>
    </div>
  );
});

/** Props for the HeaderControls component group. */
export interface HeaderControlsProps {
  readonly city?: CityPreset | undefined;
  readonly language: LanguageCode;
  readonly isHi: boolean;
  readonly isGateMode: boolean;
  readonly isSigningOut: boolean;
  readonly onCityChange?: ((cityId: string) => void) | undefined;
  readonly onLanguageChange: (language: LanguageCode) => void;
  readonly authUser?: AuthUser | undefined;
  readonly onSignOut?: (() => void) | undefined;
}

/** Renders header city selector, language switcher, and sign-out controls. */
export const HeaderControls: React.FC<HeaderControlsProps> = React.memo(
  function HeaderControls(props) {
    const {
      city, language, isHi, isGateMode, isSigningOut,
      onCityChange, onLanguageChange, authUser, onSignOut,
    } = props;
    const showCityPicker = !isGateMode && city !== undefined && onCityChange !== undefined;
    const showSessionControls = !isGateMode && authUser !== undefined && onSignOut !== undefined;
    return (
      <div className="flex flex-wrap items-center gap-3">
        {showCityPicker && (
          <CityPicker city={city} isHi={isHi} disabled={isSigningOut} onCityChange={onCityChange} />
        )}
        <LanguageSwitcher
          language={language}
          disabled={isSigningOut}
          onChange={onLanguageChange}
        />
        {showSessionControls && (
          <SessionControls
            authUser={authUser}
            isHi={isHi}
            disabled={isSigningOut}
            onSignOut={onSignOut}
          />
        )}
      </div>
    );
  },
);
