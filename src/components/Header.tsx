/**
 * Accessible top header with skip link, single H1, nav, city selector, and EN/HI toggle.
 */

import React from 'react';
import type { CityPreset, LanguageCode } from '../domain/types.js';
import type { AuthUser } from '../services/apiClient.js';
import { HeaderControls } from './HeaderControls.js';

/** Props for the top navigation Header component. */
export interface HeaderProps {
  readonly city?: CityPreset;
  readonly language: LanguageCode;
  readonly dataSource?: 'live_open_meteo' | 'city_preset';
  readonly isSyncing?: boolean;
  readonly aqUnavailable?: boolean;
  readonly hasLocalSections?: boolean;
  readonly isSigningOut?: boolean;
  readonly onCityChange?: (cityId: string) => void;
  readonly onLanguageChange: (lang: LanguageCode) => void;
  readonly isAuthenticated?: boolean;
  readonly authUser?: AuthUser;
  readonly onSignOut?: () => void;
}

const WORKSPACE_NAV_ITEMS = [
  { href: '#impact', en: 'Impact', hi: 'प्रभाव' },
  { href: '#routine', en: 'Routine', hi: 'दिनचर्या' },
  { href: '#what-if', en: 'What-If', hi: 'तुलना' },
  { href: '#rwa', en: 'RWA', hi: 'समुदाय' },
  { href: '#assistant', en: 'Assistant', hi: 'सहायक' },
] as const;

const GATE_NAV_ITEMS = [
  { href: '#gateway-login', en: 'Sign In', hi: 'लॉग इन' },
  { href: '#evaluator-access', en: 'Demo Accounts', hi: 'डेमो खाते' },
  { href: '#security-features', en: 'Security', hi: 'सुरक्षा' },
] as const;

const LOCAL_ONLY_HREFS = new Set(['#impact', '#routine', '#what-if']);

function getSourceLabel(
  dataSource: 'live_open_meteo' | 'city_preset',
  isSyncing: boolean,
  lang: LanguageCode,
  unavailable: boolean,
): string {
  const hi = lang === 'hi';
  if (unavailable) return hi ? 'स्थानीय वायु गुणवत्ता उपलब्ध नहीं' : 'Local air quality unavailable';
  if (isSyncing) return hi ? 'लाइव डेटा अपडेट हो रहा है…' : 'Updating live data…';
  if (dataSource === 'live_open_meteo') return hi ? 'लाइव Open-Meteo AQ' : 'Live Open-Meteo AQ';
  return hi ? 'ऑफ़लाइन शहर प्रीसेट' : 'Offline City Preset';
}

function getHeaderNavItems(isGateMode: boolean, hasLocalSections: boolean) {
  if (isGateMode) return GATE_NAV_ITEMS;
  return hasLocalSections
    ? WORKSPACE_NAV_ITEMS
    : WORKSPACE_NAV_ITEMS.filter((item) => !LOCAL_ONLY_HREFS.has(item.href));
}

const HeaderBrand: React.FC<{
  readonly isHi: boolean;
  readonly isGateMode: boolean;
  readonly sourceText: string;
}> = React.memo(function HeaderBrand({ isHi, isGateMode, sourceText }) {
  return (
    <div className="flex items-center gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">SmogWise Virtual</h1>
        <p className="text-xs text-slate-700">
          {isHi
            ? 'सर्दियों के स्मॉग में परिवार और समुदाय का सहायक'
            : 'Winter Smog Family & Community Assistant'}
        </p>
      </div>
      {!isGateMode && (
        <span
          className="rounded-full border border-teal-800 bg-teal-50 px-2.5 py-0.5 text-xs font-semibold text-teal-900"
          aria-live="polite"
        >
          {sourceText}
        </span>
      )}
    </div>
  );
});

const HeaderNav: React.FC<{
  readonly isHi: boolean;
  readonly isGateMode: boolean;
  readonly hasLocalSections: boolean;
}> = React.memo(function HeaderNav({ isHi, isGateMode, hasLocalSections }) {
  const navItems = getHeaderNavItems(isGateMode, hasLocalSections);
  return (
    <nav aria-label={isHi ? 'मुख्य नेविगेशन' : 'Primary navigation'}>
      <ul className="flex flex-wrap items-center gap-2 text-sm font-medium">
        {navItems.map((item) => (
          <li key={item.href}>
            <a
              href={item.href}
              className="rounded px-2.5 py-1.5 text-slate-800 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              {isHi ? item.hi : item.en}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
});

function resolveHeaderFlags(props: HeaderProps) {
  const aqUnavailable = props.aqUnavailable === true;
  return {
    isHi: props.language === 'hi',
    isGateMode: props.isAuthenticated === false,
    hasLocalSections: props.hasLocalSections ?? !aqUnavailable,
    isSigningOut: props.isSigningOut === true,
    sourceText: getSourceLabel(
      props.dataSource ?? 'city_preset',
      props.isSyncing === true,
      props.language,
      aqUnavailable,
    ),
  };
}

/** Accessible top header with skip link, single H1, nav, city selector, and EN/HI toggle. */
export const Header: React.FC<HeaderProps> = React.memo(function Header(props) {
  const {
    isHi, isGateMode, hasLocalSections, isSigningOut, sourceText,
  } = resolveHeaderFlags(props);
  return (
    <header className="border-b border-slate-300 bg-white text-slate-900 shadow-sm">
      <a href="#main-content" className="skip-link">
        {isHi ? 'मुख्य सामग्री पर जाएं' : 'Skip to main content'}
      </a>
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <HeaderBrand isHi={isHi} isGateMode={isGateMode} sourceText={sourceText} />
        <HeaderNav isHi={isHi} isGateMode={isGateMode} hasLocalSections={hasLocalSections} />
        <HeaderControls
          city={props.city}
          language={props.language}
          isHi={isHi}
          isGateMode={isGateMode}
          isSigningOut={isSigningOut}
          onCityChange={props.onCityChange}
          onLanguageChange={props.onLanguageChange}
          authUser={props.authUser}
          onSignOut={props.onSignOut}
        />
      </div>
    </header>
  );
});
