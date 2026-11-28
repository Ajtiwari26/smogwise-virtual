/** Extracts user-supplied INR caps and renders independent catalog options. */

import { IAQ_HACK_SPECS } from '../../src/domain/constants.js';
import type { LanguageCode } from '../../src/domain/types.js';

const MONEY = String.raw`([−+-]?\s*\d[\d,]*(?:\.\d+)?)`;
const CURRENCY = String.raw`(?:₹|\bINR\b|\bRs\.?|\brupees?\b|रुपये|रुपए)`;
const BUDGET = new RegExp(`${CURRENCY}\\s*${MONEY}|${MONEY}\\s*${CURRENCY}`, 'giu');

/** Returns the tightest explicitly stated currency cap, including zero and Hindi numerals. */
export function readBudgetCap(question: string): number | undefined {
  const normalized = question.normalize('NFKC').replace(/[०-९]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x966),
  );
  const caps = [...normalized.matchAll(BUDGET)].map((match) =>
    Number((match[1] ?? match[2] ?? '').replace(/[,\s]/g, '').replace('−', '-')),
  ).filter(Number.isFinite);
  return caps.length > 0 ? Math.max(0, Math.min(...caps)) : undefined;
}

/** Detects questions about intervention prices, monthly budgets, or explicit INR caps. */
export function isBudgetQuestion(question: string): boolean {
  return readBudgetCap(question) !== undefined ||
    /budget|₹|\binr\b|\brs\.?\b|\bcosts?\b|rupee|बजट|सस्त|रुप/u.test(question.toLowerCase());
}

/** Lists per-item prices without attaching the current scenario's modeled results. */
export function formatBudgetOptions(cap: number, language: LanguageCode): string {
  const hi = language === 'hi';
  const names = Object.values(IAQ_HACK_SPECS)
    .filter((hack) => hack.monthlyCostInr <= cap && hack.id !== 'ventilation_window')
    .map((hack) => `${hi ? hack.nameHi : hack.name} (₹${hack.monthlyCostInr})`)
    .join(', ');
  return hi
    ? `₹${cap}/माह के बजट में अलग-अलग विकल्प और कीमतें: ${names}।`
    : `Options under ₹${cap}/month, priced individually: ${names}.`;
}
