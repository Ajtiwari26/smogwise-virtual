/** Extracts user-supplied INR caps and renders independent catalog options. */

import { IAQ_HACK_SPECS } from '../../src/domain/constants.js';
import type { LanguageCode } from '../../src/domain/types.js';

const DIGIT = String.raw`\p{Nd}`;
const WORD = String.raw`[\p{L}\p{M}_]`;
const TOKEN_END = String.raw`(?![${DIGIT}\p{L}\p{M}_])`;
const SIGN = '[+−-]';
const GROUPED_MONEY = String.raw`\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:[^\S\r\n]+\d{3})+`;
const MONEY = String.raw`(?:${SIGN}\s*)?(?:${GROUPED_MONEY}|\d+)(?:\.\d+)?`;
const CURRENCY_UNIT = String.raw`(?:inr|rs\.?|rupees?|रुप(?:या|ये|यों|ए))`;

/** Currency markers shared by the budget parser and the evaluator. */
export const BUDGET_CURRENCY = String.raw`(?:₹|(?<!${WORD})${CURRENCY_UNIT}(?!${WORD}))`;

const PERIOD = 'months?|mos?|years?|yrs?|annum|weeks?|wks?|days?|quarters?|qtrs?|hrs?|hours?|' +
  'fortnights?';
const CADENCE = String.raw`${PERIOD}|(?:per[\p{Pd}\s]+|an?\s+)(?:${PERIOD})|` +
  'monthly|(?:bi)?weekly|daily|yearly|(?:semi)?annual(?:ly)?|quarterly|fortnightly|hourly';
const HINDI_PERIOD = 'माह|महीन(?:ा|े|ों)|वर्ष|साल|दिन|सप्ताह|हफ़्त[ाे]|हफ्त[ाे]|तिमाही';
const HINDI_CADENCE = String.raw`${HINDI_PERIOD}|प्रति\s*(?:${HINDI_PERIOD})|` +
  'मासिक|वार्षिक|सालाना|साप्ताहिक|दैनिक|त्रैमासिक';
const SCALE_UNIT = 'k|cr|bn|thousands?|lakhs?|lacs?|crores?|millions?|billions?|trillions?|' +
  'ह(?:ज\u093C?|\u095B)ार|लाख|करो(?:ड\u093C?|\u095C)|अरब|अर्ब|खरब|paise|पैस[ाे]';
const QUALIFIER = String.raw`only|max(?:imum)?|min(?:imum)?|total|budget|cap|limit|approx(?:imately)?|plus|` +
  String.raw`मात्र|केवल|सिर्फ़?|कुल|बजट|सीमा|अधिकतम|न्यूनतम|लगभग|तक|के\s+(?:करीब|आसपास)|से\s+(?:अधिक|कम)`;
const AMOUNT_WORD = String.raw`(?:${CURRENCY_UNIT}|${CADENCE}|${HINDI_CADENCE}|${SCALE_UNIT}|${QUALIFIER})${TOKEN_END}`;
// A prose count needs a word other than an amount unit, cadence, or qualifier.
const COUNT_WORD = String.raw`(?!${AMOUNT_WORD})\p{L}`;
const COMMA_GROUP = String.raw`(?:[${DIGIT}]{2}\s*,\s*)+[${DIGIT}]{3}|[0\u0966\u0660]{3}`;

/** Prevents a suffix-currency match from starting inside a number or a signed amount. */
export const BUDGET_NUMBER_START = String.raw`(?=[${DIGIT}+−-])` +
  String.raw`(?<![${DIGIT}\p{L}\p{M}_.,+−-]|${DIGIT}\s*,\s*|${DIGIT}[^\S\r\n]+|${SIGN}\s+)`;

/** Numeric continuations that prevent interpreting a partial amount as the full cap. */
export const BUDGET_NUMBER_TAIL =
  String.raw`\s*(?:[.,][${DIGIT}]|,\s*(?:${COMMA_GROUP}|[${DIGIT}]+(?![${DIGIT}]|\s+${COUNT_WORD})))` +
  String.raw`|\s+[${DIGIT}]{2,}`;

const SCALE_TAIL =
  String.raw`(?:\s*${CURRENCY_UNIT})?[\p{Pd}−\s]*(?:${SCALE_UNIT})${TOKEN_END}|` +
  String.raw`\s*(?:inr|rupees?)(?=[${DIGIT}\p{L}\p{M}_])`;

/** Rejects a match that ends inside an amount, including unsupported scales and subunits. */
export const BUDGET_AMOUNT_END = `${TOKEN_END}(?!${BUDGET_NUMBER_TAIL}|${SCALE_TAIL})`;

const BUDGET = new RegExp(
  String.raw`(?<![${DIGIT}])(${SIGN}\s*)?${BUDGET_CURRENCY}\s*(${MONEY})${BUDGET_AMOUNT_END}|` +
  String.raw`${BUDGET_NUMBER_START}(${MONEY})\s*${BUDGET_CURRENCY}${BUDGET_AMOUNT_END}`,
  'giu',
);
const BUDGET_QUESTION = new RegExp(String.raw`${BUDGET_CURRENCY}|budget|\bcosts?\b|बजट|सस्त|रुप`, 'iu');

/** Returns the tightest explicitly stated currency cap, including zero and Hindi numerals. */
export function readBudgetCap(question: string): number | undefined {
  const normalized = question.normalize('NFKC').replace(/[०-९]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x966),
  );
  const caps = [...normalized.matchAll(BUDGET)].map((match) =>
    Number(`${match[1] ?? ''}${match[2] ?? match[3]}`.replace(/[,\s]/g, '').replace('−', '-')),
  ).filter(Number.isFinite);
  return caps.length > 0 ? Math.max(0, Math.min(...caps)) : undefined;
}

/** Detects questions about intervention prices, monthly budgets, or explicit INR caps. */
export function isBudgetQuestion(question: string): boolean {
  return BUDGET_QUESTION.test(question.normalize('NFKC'));
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
