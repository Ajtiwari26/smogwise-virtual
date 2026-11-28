import { describe, expect, it } from 'vitest';
import { isGroundedBudgetReplyValid } from '../evaluator/judgeProbes.js';

describe('isGroundedBudgetReplyValid ₹50 / ५० boundary checks', () => {
  it('accepts exact ₹50, ₹५०, 50 INR, 50 rupees, and ५० रुपये forms cleanly', () => {
    const valid = [
      'Wet mopping and cross-ventilation work under ₹50 per month.',
      'आप ₹५० से कम में भी गीला पोछा चुन सकते हैं।',
      'इस श्रेणी में ५० रुपये के अंदर विकल्प मौजूद हैं।',
      'Zero-cost options stay within 50 INR.',
      'Even at 50 rupees, window-time ventilation helps.',
      'For ₹50, choose no-cost behavioural actions.',
    ];
    for (const answer of valid) {
      expect(isGroundedBudgetReplyValid(answer, 'gemini_interactions')).toBe(true);
      expect(isGroundedBudgetReplyValid(answer, 'offline_grounded')).toBe(true);
    }
  });

  it('rejects larger numbers, fractional amounts, and false prefix decimals', () => {
    const invalid = [
      'Try masks for ₹500 per month.',
      '५०० रुपये के भीतर विकल्प देखें।',
      'Spend ₹50.99 on filters.',
      'A filter costs 150 INR.',
      'Starts at 1.50 INR only.',
      'यह विकल्प १.५० रुपये में है।',
      'केवल ५०.५० रुपये खर्च करें।',
      'Up to ₹50,000 budget.',
      'Budget of 50,000 INR.',
    ];
    for (const answer of invalid) {
      expect(isGroundedBudgetReplyValid(answer, 'gemini_interactions')).toBe(false);
      expect(isGroundedBudgetReplyValid(answer, 'offline_grounded')).toBe(false);
    }
  });

  it('enforces offline mode dose-claim restriction and rejects guard refusals', () => {
    expect(isGroundedBudgetReplyValid('Under ₹50 with 120 µg/day dose.', 'offline_grounded')).toBe(false);
    expect(isGroundedBudgetReplyValid('Under ₹50 option.', 'guard_refusal')).toBe(false);
  });
});
