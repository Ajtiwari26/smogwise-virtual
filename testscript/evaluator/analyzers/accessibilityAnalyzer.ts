/**
 * Deterministic accessibility analyzer for SmogWise Virtual.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import { clamp, listSourceFiles, makeDeduction, readFileSafe, round2 } from '../utils.js';
import { checkColorAndTypography } from './accessibilityContrast.js';

const CRITERION = 'accessibility' as const;
const MAX_DETERMINISTIC = 3.5;

const HTML_CHECKS: readonly { readonly token: string; readonly label: string }[] = [
  { token: 'lang=', label: 'lang attribute on <html>' },
  { token: 'viewport', label: 'viewport meta tag' },
  { token: '<title>', label: 'document <title> element' },
];

const LANDMARK_TOKENS: readonly string[] = ['<header', '<main', '<nav', '<footer'];
const AQI_TEXT_LABELS: readonly string[] = [
  'Good',
  'Moderate',
  'Poor',
  'Severe',
  'Hazardous',
  'Unhealthy',
];

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    count += 1;
    pos = haystack.indexOf(needle, pos + needle.length);
  }
  return count;
}

function checkIndexHtml(html: string, deductions: DeductionItem[]): number {
  let passed = 0;
  for (const item of HTML_CHECKS) {
    if (html.includes(item.token)) {
      passed += 1;
    } else {
      deductions.push(
        makeDeduction(
          CRITERION,
          0.2,
          `index.html is missing ${item.label}.`,
          `Add ${item.label} to index.html.`,
        ),
      );
    }
  }
  return passed;
}

function checkLandmarks(tsx: string, deductions: DeductionItem[]): number {
  const missing = LANDMARK_TOKENS.filter((token) => !tsx.includes(token)).map((t) => t.slice(1));
  if (missing.length > 0) {
    deductions.push(
      makeDeduction(
        CRITERION,
        round2(missing.length * 0.15),
        `Missing semantic landmarks in src/**/*.tsx: ${missing.join(', ')}.`,
        'Use semantic <header>, <main>, <nav>, and <footer> elements.',
      ),
    );
  }
  return LANDMARK_TOKENS.length - missing.length;
}

function checkSkipAndHeading(tsx: string, deductions: DeductionItem[]): boolean {
  const hasSkip = tsx.includes('#main-content') || tsx.includes('Skip to');
  if (!hasSkip) {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.2,
        'No skip-to-content link (#main-content or Skip to) found.',
        'Add a visually hidden skip link targeting #main-content.',
      ),
    );
  }
  const h1Count = countOccurrences(tsx, '<h1');
  if (h1Count !== 1) {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.2,
        `Expected exactly 1 <h1> heading across src/**/*.tsx, found ${String(h1Count)}.`,
        'Ensure the application renders a single top-level <h1> heading.',
      ),
    );
  }
  return hasSkip && h1Count === 1;
}

function checkInteractiveA11y(tsx: string, deductions: DeductionItem[]): number {
  const checks: readonly { readonly ok: boolean; readonly ev: string; readonly fix: string }[] = [
    {
      ok: tsx.includes('aria-live'),
      ev: 'No aria-live region found for dynamic AQI/alert updates.',
      fix: 'Add aria-live="polite" or "assertive" to dynamic status regions.',
    },
    {
      ok: tsx.includes('htmlFor') || tsx.includes('aria-label'),
      ev: 'No explicit label association (htmlFor or aria-label) found.',
      fix: 'Associate form controls with htmlFor or aria-label attributes.',
    },
    {
      ok: tsx.includes('focus-visible:') || tsx.includes('focus:ring'),
      ev: 'No keyboard focus ring classes (focus-visible: or focus:ring) found.',
      fix: 'Add focus-visible: or focus:ring styles to interactive controls.',
    },
    {
      ok: tsx.includes('aria-invalid') && tsx.includes('aria-describedby'),
      ev: 'Form error states lack aria-invalid and aria-describedby linkage.',
      fix: 'Bind aria-invalid and aria-describedby to validation error elements.',
    },
    {
      ok: tsx.includes('role="combobox"') && tsx.includes('scope="col"'),
      ev: 'Missing WAI-ARIA combobox or accessible data-table column headers.',
      fix: 'Include role="combobox" on location search and scope="col" on summary table.',
    },
  ];
  let passed = 0;
  for (const item of checks) {
    if (item.ok) passed += 1;
    else deductions.push(makeDeduction(CRITERION, 0.2, item.ev, item.fix));
  }
  return passed;
}

function checkLangAndAqiLabels(tsx: string, deductions: DeductionItem[]): number {
  let passed = 0;
  if (tsx.includes('document.documentElement.lang')) {
    passed += 1;
  } else {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.15,
        'Dynamic document.documentElement.lang update not found.',
        'Sync document.documentElement.lang when switching languages.',
      ),
    );
  }
  const labelHits = AQI_TEXT_LABELS.filter((label) => tsx.includes(label)).length;
  if (labelHits >= 2) {
    passed += 1;
  } else {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.25,
        'Non-color-only AQI category text labels not detected in TSX.',
        'Display explicit text labels (Good, Moderate, Poor, Severe) with colors.',
      ),
    );
  }
  return passed;
}

function buildMissingAppResult(): AnalyzerResult {
  return {
    criterion: CRITERION,
    deterministicScore: 0,
    maxDeterministic: MAX_DETERMINISTIC,
    deductions: [
      makeDeduction(
        CRITERION,
        MAX_DETERMINISTIC,
        'src/App.tsx does not exist; accessibility checks cannot pass.',
        'Create src/App.tsx with accessible landmarks, labels, and contrast.',
      ),
    ],
    metrics: { appExists: false },
  };
}

/** Runs deterministic WCAG 2.1 and semantic accessibility checks on the workspace. */
export async function runAccessibilityAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  if (!fs.existsSync(path.join(rootDir, 'src', 'App.tsx'))) {
    return Promise.resolve(buildMissingAppResult());
  }
  const deductions: DeductionItem[] = [];
  const indexHtml = readFileSafe(path.join(rootDir, 'index.html'));
  const tsxFiles = listSourceFiles(path.join(rootDir, 'src'), ['.tsx']);
  const tsAndTsxFiles = listSourceFiles(path.join(rootDir, 'src'), ['.ts', '.tsx']);
  const tsxJoined = tsxFiles.map((file) => readFileSafe(file)).join('\n');
  const allSrcJoined = tsAndTsxFiles.map((file) => readFileSafe(file)).join('\n');

  const htmlPassed = checkIndexHtml(indexHtml, deductions);
  const landmarksFound = checkLandmarks(tsxJoined, deductions);
  const skipAndH1Ok = checkSkipAndHeading(tsxJoined, deductions);
  const interactivePassed = checkInteractiveA11y(tsxJoined, deductions);
  const langAndAqiPassed = checkLangAndAqiLabels(allSrcJoined, deductions);
  const contrast = checkColorAndTypography(rootDir, tsxJoined, deductions);

  const totalDeducted = deductions.reduce((sum, item) => sum + item.points, 0);
  return Promise.resolve({
    criterion: CRITERION,
    deterministicScore: clamp(round2(MAX_DETERMINISTIC - totalDeducted), 0, MAX_DETERMINISTIC),
    maxDeterministic: MAX_DETERMINISTIC,
    deductions,
    metrics: {
      appExists: true,
      tsxFileCount: tsxFiles.length,
      htmlChecksPassed: htmlPassed,
      landmarksFound,
      skipAndH1Ok,
      interactiveChecksPassed: interactivePassed,
      langAndAqiChecksPassed: langAndAqiPassed,
      hexColorsParsed: contrast.hexCount,
      bestBodyContrast: contrast.bestBodyRatio,
      minUiContrast: contrast.minUiRatio,
      contrastPassed: contrast.passed,
    },
  });
}
