/**
 * Color-contrast math and sub-12px/control-border accessibility checks for SmogWise Virtual.
 */

import path from 'node:path';
import type { DeductionItem } from '../types.js';
import { makeDeduction, readFileSafe, round2 } from '../utils.js';

const CRITERION = 'accessibility' as const;
const BODY_CONTRAST_MIN = 4.5;
const UI_CONTRAST_MIN = 3.0;
const CONTRAST_DEDUCTION = 1.5;

/** Summary of WCAG color contrast measurements across Tailwind/CSS theme definitions. */
export interface ContrastSummary {
  readonly hexCount: number;
  readonly bestBodyRatio: number;
  readonly minUiRatio: number;
  readonly passed: boolean;
}

function srgbToLinear(hexPair: string): number {
  const srgb = Number.parseInt(hexPair, 16) / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const clean = hex.slice(1);
  return (
    0.2126 * srgbToLinear(clean.slice(0, 2)) +
    0.7152 * srgbToLinear(clean.slice(2, 4)) +
    0.0722 * srgbToLinear(clean.slice(4, 6))
  );
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return round2((lighter + 0.05) / (darker + 0.05));
}

function extractUniqueHexColors(source: string): string[] {
  const matches = source.match(/#[0-9a-fA-F]{6}/g);
  return matches === null ? [] : [...new Set(matches.map((hex) => hex.toLowerCase()))];
}

function computeContrastStats(colors: readonly string[]): ContrastSummary {
  if (colors.length < 2) {
    return { hexCount: colors.length, bestBodyRatio: 1, minUiRatio: 1, passed: false };
  }
  const sorted = [...colors].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const darkest = sorted[0];
  const lightest = sorted[sorted.length - 1];
  if (darkest === undefined || lightest === undefined) {
    return { hexCount: colors.length, bestBodyRatio: 1, minUiRatio: 1, passed: false };
  }
  const bestBodyRatio = contrastRatio(darkest, lightest);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? darkest;
  const minUiRatio =
    colors.length === 2
      ? bestBodyRatio
      : Math.min(contrastRatio(mid, lightest), contrastRatio(mid, darkest));
  return {
    hexCount: colors.length,
    bestBodyRatio,
    minUiRatio,
    passed: bestBodyRatio >= BODY_CONTRAST_MIN && minUiRatio >= UI_CONTRAST_MIN,
  };
}

/** Verifies CSS/Tailwind theme contrast and rejects sub-12px micro-text or weak input borders. */
export function checkColorAndTypography(
  rootDir: string,
  tsxJoined: string,
  deductions: DeductionItem[],
): ContrastSummary {
  const cssText = readFileSafe(path.join(rootDir, 'src', 'index.css'));
  const twText = readFileSafe(path.join(rootDir, 'tailwind.config.ts'));
  const summary = computeContrastStats(extractUniqueHexColors(`${cssText}\n${twText}`));
  if (!summary.passed) {
    deductions.push(
      makeDeduction(
        CRITERION,
        CONTRAST_DEDUCTION,
        `WCAG 2.1 contrast below threshold (body: ${String(summary.bestBodyRatio)}:1, UI: ${String(summary.minUiRatio)}:1).`,
        'Ensure body text contrast >= 4.5:1 and UI component contrast >= 3.0:1.',
      ),
    );
  }
  if (/text-\[(?:9|10|11)px\]/.test(tsxJoined)) {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.25,
        'Sub-12px typography (text-[11px]/text-[10px]) detected in src/**/*.tsx.',
        'Upgrade micro-labels to text-xs (12px) or larger.',
      ),
    );
  }
  if (!tsxJoined.includes('border-slate-500')) {
    deductions.push(
      makeDeduction(
        CRITERION,
        0.25,
        'High-contrast border-slate-500 control border token not found in TSX.',
        'Use border-slate-500 (>= 3:1 against white) on form inputs and pills.',
      ),
    );
  }
  return summary;
}
