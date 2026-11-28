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
const SCOPE = 'households?|famil(?:y|ies)|flats?|homes?|rooms?|persons?|residents?|members?|' +
  'adults?|child(?:ren)?|commuters?|heads?|units?';
const EN_CADENCE_PART = String.raw`(?:per[\p{Pd}\s]+|every\s+|each\s+|an?\s+)(?:${PERIOD}|${SCOPE})|` +
  String.raw`(?:${PERIOD})|monthly|(?:bi)?weekly|daily|yearly|(?:semi|half)[\p{Pd}\s]?annual(?:ly)?|` +
  String.raw`annually|annual|quarterly|fortnightly|hourly|p\.a\.?`;
const CADENCE = String.raw`(?:${EN_CADENCE_PART})(?:[\p{Pd}\s]+(?:${EN_CADENCE_PART}))*`;
const HINDI_PERIOD = 'माह|महीन(?:ा|े|ों)|वर्ष|साल|दिन|सप्ताह|हफ़्त[ाे]|हफ्त[ाे]|तिमाही|छमाही';
const HINDI_SCOPE = 'घर|परिवार|फ़्लैट|फ्लैट|व्यक्ति|सदस्य';
const HI_CADENCE_PART = String.raw`(?:प्रति|हर|प्रत्येक)\s*(?:${HINDI_PERIOD}|${HINDI_SCOPE})|` +
  String.raw`(?:${HINDI_PERIOD})|मासिक|वार्षिक|अर्धवार्षिक|सालाना|साप्ताहिक|दैनिक|त्रैमासिक`;
const HINDI_CADENCE = String.raw`(?:${HI_CADENCE_PART})(?:\s+(?:${HI_CADENCE_PART}))*`;
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

const EN_SCOPE_PART = String.raw`(?:per[\p{Pd}\s]+|every\s+|each\s+|an?\s+)(?:${SCOPE})`;
const HI_SCOPE_PART = String.raw`(?:प्रति|हर|प्रत्येक)\s*(?:${HINDI_SCOPE})`;
const ANNUAL_TAIL = String.raw`(?:(?:per[\p{Pd}\s]+|every\s+|each\s+|an?\s+)(?:years?|yrs?|annum)|years?|yrs?|yearly|annual(?:ly)?|p\.a\.?|वार्षिक|सालाना|(?:प्रति|हर|प्रत्येक)?\s*(?:वर्ष|साल))`;
const SEMI_ANNUAL_TAIL = String.raw`(?:(?:semi|half)[\p{Pd}\s]?annual(?:ly)?|अर्धवार्षिक|छमाही)`;
const QUARTERLY_TAIL = String.raw`(?:quarterly|(?:per[\p{Pd}\s]+|every\s+|each\s+|an?\s+)?quarters?|तिमाही|त्रैमासिक)`;
const TRAILING_PERIOD = new RegExp(
  String.raw`^(?:\s*(?:${EN_SCOPE_PART}|${HI_SCOPE_PART}))*[\p{Pd}\s/]+` +
  String.raw`(?:(${SEMI_ANNUAL_TAIL})|(${QUARTERLY_TAIL})|(${ANNUAL_TAIL}))${TOKEN_END}`,
  'iu',
);

function periodDivisor(tail: string): number {
  const match = TRAILING_PERIOD.exec(tail);
  if (match === null) return 1;
  if (match[1] !== undefined) return 6;
  if (match[2] !== undefined) return 3;
  return 12;
}

/** Returns the tightest explicitly stated currency cap, including zero and Hindi numerals. */
export function readBudgetCap(question: string): number | undefined {
  const normalized = question.normalize('NFKC').replace(/[०-९]/g, (digit) =>
    String(digit.charCodeAt(0) - 0x966),
  );
  const caps = [...normalized.matchAll(BUDGET)].map((match) => {
    const raw = Number(`${match[1] ?? ''}${match[2] ?? match[3]}`.replace(/[,\s]/g, '').replace('−', '-'));
    if (!Number.isFinite(raw)) return Number.NaN;
    const endIdx = (match.index ?? 0) + match[0].length;
    const divisor = periodDivisor(normalized.slice(endIdx));
    return divisor > 1 ? Math.floor((raw * 100) / divisor + 1e-9) / 100 : raw;
  }).filter(Number.isFinite);
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
