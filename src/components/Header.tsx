import React from 'react';
import { CITY_PRESETS } from '../domain/cityPresets.js';
import type { CityPreset, LanguageCode } from '../domain/types.js';

/** Props for the top navigation Header component. */
export interface HeaderProps {
  readonly city: CityPreset;
  readonly language: LanguageCode;
  readonly dataSource: 'live_open_meteo' | 'city_preset';
  readonly isSyncing: boolean;
  readonly onCityChange: (cityId: string) => void;
  readonly onLanguageChange: (lang: LanguageCode) => void;
}

const NAV_ITEMS = [
  { href: '#impact', en: 'Impact', hi: 'प्रभाव' },
  { href: '#routine', en: 'Routine', hi: 'दिनचर्या' },
  { href: '#what-if', en: 'What-If', hi: 'तुलना' },
  { href: '#rwa', en: 'RWA', hi: 'समुदाय' },
  { href: '#assistant', en: 'Assistant', hi: 'सहायक' },
] as const;

function getSourceLabel(
  dataSource: 'live_open_meteo' | 'city_preset',
  isSyncing: boolean,
  lang: LanguageCode,
): string {
  if (isSyncing) {
    return lang === 'hi' ? 'अपडेट हो रहा है...' : 'Syncing AQ...';
  }
  if (dataSource === 'live_open_meteo') {
    return lang === 'hi' ? 'लाइव Open-Meteo AQ' : 'Live Open-Meteo AQ';
  }
  return lang === 'hi' ? 'ऑफ़लाइन शहर प्रीसेट' : 'Offline City Preset';
}

const LanguageSwitcher: React.FC<{
  readonly language: LanguageCode;
  readonly onChange: (lang: LanguageCode) => void;
}> = React.memo(function LanguageSwitcher({ language, onChange }) {
  const isHi = language === 'hi';
  return (
    <div
      role="group"
      aria-label={isHi ? 'भाषा चुनें' : 'Language selector'}
      className="inline-flex rounded-md border border-slate-400 bg-slate-100 p-0.5"
    >
      <button
        type="button"
        lang="en"
        aria-pressed={language === 'en'}
        onClick={() => onChange('en')}
        className={`rounded px-2.5 py-1 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-teal-700 ${
          language === 'en' ? 'bg-slate-900 text-white' : 'text-slate-800 hover:bg-slate-200'
        }`}
      >
        EN
      </button>
      <button
        type="button"
        lang="hi"
        aria-pressed={language === 'hi'}
        onClick={() => onChange('hi')}
        className={`rounded px-2.5 py-1 text-xs font-semibold focus-visible:ring-2 focus-visible:ring-teal-700 ${
          language === 'hi' ? 'bg-slate-900 text-white' : 'text-slate-800 hover:bg-slate-200'
        }`}
      >
        हिन्दी
      </button>
    </div>
  );
});

const CityPicker: React.FC<{
  readonly cityId: string;
  readonly isHi: boolean;
  readonly onCityChange: (cityId: string) => void;
}> = React.memo(function CityPicker({ cityId, isHi, onCityChange }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="header-city-select" className="text-xs font-semibold text-slate-800">
        {isHi ? 'शहर' : 'City'}
      </label>
      <select
        id="header-city-select"
        value={cityId}
        onChange={(e) => onCityChange(e.target.value)}
        className="rounded-md border border-slate-400 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus-visible:ring-2 focus-visible:ring-teal-700"
      >
        {CITY_PRESETS.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {isHi ? preset.nameHi : preset.name}
          </option>
        ))}
      </select>
    </div>
  );
});

/** Accessible top header with skip link, single H1, nav, city selector, and EN/HI toggle. */
export const Header: React.FC<HeaderProps> = React.memo(function Header({
  city,
  language,
  dataSource,
  isSyncing,
  onCityChange,
  onLanguageChange,
}) {
  const isHi = language === 'hi';
  const sourceText = getSourceLabel(dataSource, isSyncing, language);

  return (
    <header className="border-b border-slate-300 bg-white text-slate-900 shadow-sm">
      <a href="#main-content" className="skip-link">
        {isHi ? 'मुख्य सामग्री पर जाएं' : 'Skip to main content'}
      </a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              SmogWise Virtual
            </h1>
            <p className="text-xs text-slate-700">
              {isHi
                ? 'सर्दियों के स्मॉग में परिवार और समुदाय का सहायक'
                : 'Winter Smog Family & Community Assistant'}
            </p>
          </div>
          <span
            className="rounded-full border border-teal-800 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-900"
            aria-live="polite"
          >
            {sourceText}
          </span>
        </div>

        <nav aria-label={isHi ? 'मुख्य नेविगेशन' : 'Primary navigation'}>
          <ul className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="rounded px-2.5 py-1.5 text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-teal-700"
                >
                  {isHi ? item.hi : item.en}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-wrap items-center gap-3">
          <CityPicker cityId={city.id} isHi={isHi} onCityChange={onCityChange} />
          <LanguageSwitcher language={language} onChange={onLanguageChange} />
        </div>
      </div>
    </header>
  );
});
