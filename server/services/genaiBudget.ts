/** Extracts user-supplied INR caps and renders independent catalog options. */

import { IAQ_HACK_SPECS } from '../../src/domain/constants.js';
import type { LanguageCode } from '../../src/domain/types.js';

const DIGIT = String.raw`\p{Nd}`;
const GROUPED_MONEY = String.raw`\d{1,3}(?:(?:,\d{2,3})+|(?: +\d{3})+)`;
const MONEY = String.raw`([−+-]?\s*(?:${GROUPED_MONEY}|\d+)(?:\.\d+)?)`;
const CURRENCY = String.raw`(?:₹|\bINR\b|\bRs\.?|\brupees?\b|रुपये|रुपए)`;

// A three-digit count can follow a prose comma. Currency and billing units continue the amount.
const COUNT_WORD = String.raw`(?!inr\b|rupees?\b|रुप(?:ये|ए)|per\s+month\b)[\p{L}\p{M}]`;
const COMMA_GROUP = String.raw`(?:[${DIGIT}]{2}\s*,\s*)+[${DIGIT}]{3}|[0\u0966\u0660]{3}`;

/** Numeric continuations that prevent interpreting a partial amount as the full cap. */
export const BUDGET_NUMBER_TAIL =
  String.raw`\s*(?:[.,][${DIGIT}]|,\s*(?:${COMMA_GROUP}|[${DIGIT}]{3}(?!\s+${COUNT_WORD})))` +
  String.raw`|\s+[${DIGIT}]{2,}`;

const BUDGET = new RegExp(
  String.raw`${CURRENCY}\s*${MONEY}(?![${DIGIT}]|${BUDGET_NUMBER_TAIL})|${MONEY}\s*${CURRENCY}`,
  'giu',
);

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
