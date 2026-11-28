/** Extracts user-supplied INR caps and renders independent catalog options. */

import { IAQ_HACK_SPECS } from '../../src/domain/constants.js';
import type { LanguageCode } from '../../src/domain/types.js';

const DIGIT = String.raw`\p{Nd}`;
const WORD = String.raw`[\p{L}\p{M}_]`;
const TOKEN_END = String.raw`(?![${DIGIT}\p{L}\p{M}_])`;
const SIGN = '[+−-]';
const GROUPED_MONEY = String.raw`\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?: \d{3})+`;
const MONEY = String.raw`(?:${SIGN} ?)?(?:${GROUPED_MONEY}|\d+)(?:\.\d+)?`;
const CURRENCY_UNIT = String.raw`(?:inr|rs\.?|rupees?|रुप(?:या|ये|यों|ए))`;
const CURRENCY = String.raw`(?:₹|(?<!${WORD})${CURRENCY_UNIT}(?!${WORD}))`;

const EN_PREFIX = String.raw`(?:per[\p{Pd} ]+|every |each |an? )`;
const HI_PREFIX = String.raw`(?:(?:प्रति|हर|प्रत्येक) ?)`;
const ANNUAL = 'yearly|annual(?:ly)?|वार्षिक|सालाना';
const QUARTERLY = 'quarterly|तिमाही|त्रैमासिक';
const SEMI_ANNUAL = String.raw`(?:semi|half)[\p{Pd} ]?annual(?:ly)?|half[\p{Pd} ]yearly`;
const ANNUAL_TAIL = String.raw`${EN_PREFIX}?(?:years?|yrs?|annum)|p\.a\.?|${HI_PREFIX}?(?:वर्ष|साल|${ANNUAL})`;
const QUARTERLY_TAIL = String.raw`${EN_PREFIX}?(?:quarters?|qtrs?)|${HI_PREFIX}?(?:${QUARTERLY})`;
const SEMI_ANNUAL_TAIL = String.raw`${SEMI_ANNUAL}|${HI_PREFIX}?(?:छमाही|अर्धवार्षिक)`;
const MONTHLY_TAIL = String.raw`${EN_PREFIX}?(?:months?|mos?)|monthly|p\.m\.?|` +
  String.raw`${HI_PREFIX}?(?:माह|महीन(?:ा|े|ों)|मासिक)`;
const OTHER_PERIOD = String.raw`${EN_PREFIX}?(?:weeks?|wks?|days?|hrs?|hours?|fortnights?)|` +
  String.raw`(?:bi)?weekly|daily|fortnightly|hourly|` +
  String.raw`${HI_PREFIX}?(?:दिन|सप्ताह|हफ़्त[ाे]|हफ्त[ाे]|साप्ताहिक|दैनिक)`;
const SCOPE = 'households?|famil(?:y|ies)|flats?|homes?|rooms?|persons?|residents?|members?|' +
  'adults?|child(?:ren)?|commuters?|heads?|units?';
const EN_SCOPE = String.raw`${EN_PREFIX}(?:${SCOPE})`;
const HI_SCOPE = String.raw`${HI_PREFIX}(?:घर|परिवार|फ़्लैट|फ्लैट|व्यक्ति|सदस्य)`;
const CADENCE = String.raw`(?:${SEMI_ANNUAL_TAIL}|${QUARTERLY_TAIL}|${ANNUAL_TAIL}|${MONTHLY_TAIL}|${OTHER_PERIOD})`;
const SCALE_UNIT = 'k|cr|bn|thousands?|lakhs?|lacs?|crores?|millions?|billions?|trillions?|' +
  'ह(?:ज\u093C?|\u095B)ार|लाख|करो(?:ड\u093C?|\u095C)|अरब|अर्ब|खरब|paise|पैस[ाे]';
const QUALIFIER = String.raw`only|max(?:imum)?|min(?:imum)?|total|budget|cap|limit|approx(?:imately)?|plus|` +
  String.raw`मात्र|केवल|सिर्फ़?|कुल|बजट|सीमा|अधिकतम|न्यूनतम|लगभग|तक|के (?:करीब|आसपास)|से (?:अधिक|कम)`;
const AMOUNT_WORD = String.raw`(?:${CURRENCY_UNIT}|${SCALE_UNIT}|${QUALIFIER}|${EN_SCOPE}|${HI_SCOPE}|` +
  String.raw`(?:[([] ?|/ ?)?${CADENCE})${TOKEN_END}`;
// A prose count needs a word other than an amount unit, cadence, or qualifier.
const COUNT_WORD = String.raw`(?!${AMOUNT_WORD})\p{L}`;
const COMMA_GROUP = String.raw`(?:[${DIGIT}]{2} ?, ?)+[${DIGIT}]{3}|[0\u0966\u0660]{3}`;
const NUMBER_START = String.raw`(?=[${DIGIT}+−-])` +
  String.raw`(?<![${DIGIT}\p{L}\p{M}_.,+−-]|${DIGIT} ?, ?|${DIGIT} |${SIGN} )`;
const NUMBER_TAIL =
  String.raw` ?(?:[.,][${DIGIT}]|, ?(?:${COMMA_GROUP}|[${DIGIT}]+(?![${DIGIT}]| ${COUNT_WORD})))` +
  String.raw`| [${DIGIT}]{2,}`;
const SCALE_TAIL =
  String.raw`(?: ?${CURRENCY_UNIT})?[\p{Pd}− ]*(?:${SCALE_UNIT})${TOKEN_END}|` +
  String.raw` ?(?:inr|rupees|rupee(?!s))(?=[${DIGIT}\p{L}\p{M}_])`;
const AMOUNT_END = `${TOKEN_END}(?!${NUMBER_TAIL}|${SCALE_TAIL})`;

const BUDGET = new RegExp(
  String.raw`(?<![${DIGIT}])(${SIGN} ?)?${CURRENCY} ?(${MONEY})${AMOUNT_END}|` +
  String.raw`${NUMBER_START}(${MONEY}) ?${CURRENCY}${AMOUNT_END}`,
  'giu',
);
const BUDGET_QUESTION = new RegExp(String.raw`${CURRENCY}|budget|\bcosts?\b|बजट|सस्त|रुप`, 'iu');

const PERIOD_GAP = String.raw`[\p{Pd} /]+`;
const SCOPE_PHRASE = String.raw`(?:${EN_SCOPE}|${HI_SCOPE})${TOKEN_END}`;
const PERIOD_OPENER = String.raw`[\[(]`;
const TRAILING_START = new RegExp(
  String.raw`(?: ${CURRENCY_UNIT}${TOKEN_END})?(?:${PERIOD_GAP}${SCOPE_PHRASE})*` +
  String.raw`(?:${PERIOD_GAP}|(?=${PERIOD_OPENER}))(${PERIOD_OPENER})? ?`,
  'iuy',
);
const TRAILING_PERIOD = new RegExp(
  String.raw`(?:${SCOPE_PHRASE}${PERIOD_GAP})*` +
  String.raw`(?:(${SEMI_ANNUAL_TAIL})|(${QUARTERLY_TAIL})|(${ANNUAL_TAIL})|(${MONTHLY_TAIL})|${OTHER_PERIOD})${TOKEN_END}`,
  'iuy',
);
const BUDGET_NOUN = 'budgets?|caps?|limits?|spend(?:ing)?|allowances?|बजट|सीमा|खर्च|भत्ता';
const PRECEDING_PERIOD = new RegExp(
  String.raw`(?<=(?<!${WORD})(?:(${SEMI_ANNUAL}|छमाही|अर्धवार्षिक)|(${QUARTERLY})|(${ANNUAL})) (?:${BUDGET_NOUN})` +
  String.raw`(?: (?:is|of|at|है))?(?: (?:under|up to|at most))?(?: ?[:=])? ?)`,
  'iuy',
);

function hasMatchingCloser(text: string, stop: number, opener: string): boolean {
  const closer = text[stop] === ' ' ? stop + 1 : stop;
  return text[closer] === (opener === '(' ? ')' : ']');
}

function trailingDivisor(text: string, end: number): number | null | undefined {
  TRAILING_START.lastIndex = end;
  const start = TRAILING_START.exec(text);
  if (start === null) return undefined;
  TRAILING_PERIOD.lastIndex = TRAILING_START.lastIndex;
  const match = TRAILING_PERIOD.exec(text);
  if (match === null) return undefined;
  if (start[1] !== undefined && !hasMatchingCloser(text, TRAILING_PERIOD.lastIndex, start[1])) {
    return undefined;
  }
  if (match[1] !== undefined) return 6;
  if (match[2] !== undefined) return 3;
  if (match[3] !== undefined) return 12;
  return match[4] === undefined ? null : 1;
}

function precedingDivisor(text: string, start: number): number {
  PRECEDING_PERIOD.lastIndex = start;
  const match = PRECEDING_PERIOD.exec(text);
  if (match?.[1] !== undefined) return 6;
  if (match?.[2] !== undefined) return 3;
  return match?.[3] === undefined ? 1 : 12;
}

function* readBudgetAmounts(
  question: string,
): Generator<{ amount: number; divisor: number | null }> {
  // Normalize horizontal whitespace once so number and cadence boundaries have bounded gaps.
  const text = question.normalize('NFKC').replace(/[^\S\r\n\u2028\u2029]+/g, ' ')
    .replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x966));
  for (const match of text.matchAll(BUDGET)) {
    const amount = Number(`${match[1] ?? ''}${match[2] ?? match[3]}`
      .replace(/[, ]/g, '').replace('−', '-'));
    if (!Number.isFinite(amount)) continue;
    const trailing = trailingDivisor(text, match.index + match[0].length);
    const divisor = trailing === undefined ? precedingDivisor(text, match.index) : trailing;
    yield { amount, divisor };
  }
}

/** Returns the tightest explicitly stated currency cap, including zero and Hindi numerals. */
export function readBudgetCap(question: string): number | undefined {
  let cap: number | undefined;
  for (const { amount, divisor } of readBudgetAmounts(question)) {
    // Preserve the stated ceiling for cadences without a monthly conversion.
    const monthly = amount / (divisor ?? 1);
    const rounded = divisor === null || divisor === 1 || monthly > Number.MAX_SAFE_INTEGER / 100
      ? monthly : Math.floor(monthly * 100 + 1e-9) / 100;
    cap = Math.min(cap ?? Infinity, Math.max(0, rounded));
  }
  return cap;
}

/** Checks for an exact monthly equivalent of a stated INR amount. */
export function mentionsMonthlyBudget(text: string, cap: number): boolean {
  for (const { amount, divisor } of readBudgetAmounts(text)) {
    if (divisor !== null && amount === cap * divisor) return true;
  }
  return false;
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
