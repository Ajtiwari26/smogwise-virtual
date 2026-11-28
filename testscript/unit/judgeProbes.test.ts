import { describe, expect, it } from 'vitest';
import { isGroundedBudgetReplyValid } from '../evaluator/judgeProbes.js';

describe.each(['offline_grounded', 'gemini_interactions'])(
  'isGroundedBudgetReplyValid ₹50 / ५० boundaries in %s',
  (mode) => {
    it.each([
      'Wet mopping and cross-ventilation work under ₹50 per month.',
      'आप ₹५० से कम में भी गीला पोछा चुन सकते हैं।',
      'इस श्रेणी में ५० रुपये के अंदर विकल्प मौजूद हैं।',
      'Zero-cost options stay within 50 INR.',
      'Even at 50 rupees, window-time ventilation helps.',
      'For ₹50, choose no-cost behavioural actions.',
      'Wet mopping costs ₹50 monthly.',
      'Only ₹50/mo needed.',
      'Under ₹50, 2 hacks fit.',
      'Under ₹50, 12 hacks fit.',
      '₹50, १० उपाय उपलब्ध हैं।',
      'Under ₹50. 12 options are listed below.',
      '₹५०.\n१२ उपाय उपलब्ध हैं।',
      '₹50,\u00a012 hacks fit.',
      '50 INR, 12 options fit.',
      'Monthly cap: INR 50.',
      'Rs. 50.',
      'Rs.50',
      'Rs 50',
      'बजट ५० रुपए है।',
      'Cap: ₹50, 120 distinct options are listed below.',
      '₹50, 120 options are listed below',
      '₹50, 12 options',
      '५० रुपये।',
      '₹५०',
    ])('accepts %j', (answer) => {
      expect(isGroundedBudgetReplyValid(answer, mode)).toBe(true);
    });

    it.each([
      'Try masks for ₹500 per month.',
      '५०० रुपये के भीतर विकल्प देखें।',
      'Spend ₹50.99 on filters.',
      'A filter costs 150 INR.',
      'Starts at 1.50 INR only.',
      'यह विकल्प १.५० रुपये में है।',
      'केवल ५०.५० रुपये खर्च करें।',
      'Up to ₹50,000 budget.',
      'Budget of 50,000 INR.',
      'Try masks for ₹50k.',
      'Budget ₹50K max.',
      'Costs ₹50 lakh.',
      'Costs ₹50 lakhs.',
      'Costs ₹50 हजार.',
      'Costs ₹50 हज़ार.',
      'Spend ₹50 000 now.',
      '₹50\u202f000',
      '₹50, 000',
      'Spend ₹50, 000 now.',
      '₹50 , 000',
      '₹५०, ०००',
      '₹५० , ०००',
      '₹५०\u202f०००',
      '₹50\u00a0,\u2009123',
      '₹50, 12,345',
      '₹50, ٠٠٠',
      '₹50 .99',
      'The monthly cap is ₹50, 500 per month.',
      'The monthly cap is −₹50.',
      'The monthly cap is -₹50.',
      'The monthly cap is − ₹50.',
      'The monthly cap is - ₹50.',
      'Spend ₹50 billion total.',
      'कुल ₹५० अरब बजट।',
      'Spend ₹50INRish.',
      'Spend ₹50 INRish.',
      'Budget of ₹50cr total.',
      'Spend ५० लाख रुपये.',
      'Filter costs 50 INRish today.',
      '₹50\u202fbillion',
      '₹५०\tअरब',
      '50 rupees−crore',
    ])('rejects %j', (answer) => {
      expect(isGroundedBudgetReplyValid(answer, mode)).toBe(false);
    });

    // Unicode Dash_Punctuation code points plus U+2212 (minus sign).
    const dashes = [
      0x002d, 0x058a, 0x05be, 0x1400, 0x1806, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014,
      0x2015, 0x2212, 0x2e17, 0x2e1a, 0x2e3a, 0x2e3b, 0x2e40, 0x2e5d, 0x301c, 0x3030,
      0x30a0, 0xfe31, 0xfe32, 0xfe58, 0xfe63, 0xff0d, 0x10d6e, 0x10ead,
    ].map((codePoint) => String.fromCodePoint(codePoint));

    it.each(dashes)('rejects multipliers after dash %j', (dash) => {
      expect(isGroundedBudgetReplyValid(`₹50${dash}billion`, mode)).toBe(false);
      expect(isGroundedBudgetReplyValid(`₹५०${dash}अरब`, mode)).toBe(false);
      expect(isGroundedBudgetReplyValid(`₹50${dash}lakh`, mode)).toBe(false);
      expect(isGroundedBudgetReplyValid(`₹50 ${dash} lakh`, mode)).toBe(false);
      expect(isGroundedBudgetReplyValid(`₹50${dash}crore`, mode)).toBe(false);
    });
  },
);

it('enforces offline mode dose-claim restriction and rejects guard refusals', () => {
  const answer = 'Under ₹50 with 120 µg/day dose.';
  expect(isGroundedBudgetReplyValid(answer, 'offline_grounded')).toBe(false);
  expect(isGroundedBudgetReplyValid(answer, 'gemini_interactions')).toBe(true);
  expect(isGroundedBudgetReplyValid('Under ₹50 option.', 'guard_refusal')).toBe(false);
});
