/**
 * Shared accessible bilingual application footer used across LoginGate and Workspace.
 */

import React from 'react';
import type { LanguageCode } from '../domain/types.js';

/** Props for the AppFooter component. */
export interface AppFooterProps {
  readonly language: LanguageCode;
}

/** Renders the global SmogWise Virtual bilingual footer landmark. */
export const AppFooter: React.FC<AppFooterProps> = React.memo(function AppFooter({ language }) {
  const isHi = language === 'hi';
  return (
    <footer className="mt-8 border-t border-slate-300 bg-white py-4 text-center text-xs text-slate-700">
      {isHi
        ? 'SmogWise Virtual · सत्यापित Tier-1 भौतिकी मॉडल + ग्राउंडेड AI मार्गदर्शन'
        : 'SmogWise Virtual · Deterministic Tier-1 Physics Engine + Grounded AI Guidance'}
    </footer>
  );
});
