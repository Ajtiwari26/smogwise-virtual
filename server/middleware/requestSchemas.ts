/**
 * Zod v4 API request schemas aligned with Tier 1 domain physical limits.
 */

import { z } from 'zod';
import {
  MAX_ASSISTANT_QUESTION_LENGTH,
  MAX_BUDGET_INR,
  MAX_COMMUTE_KM,
  MAX_HOUSEHOLD_SIZE,
  MAX_ROOM_VOLUME_M3,
  MAX_RWA_HOUSEHOLDS,
  MIN_ROOM_VOLUME_M3,
} from '../../src/domain/constants.js';
import {
  COMMUTE_MODES,
  COOKING_FUELS,
  IAQ_HACK_IDS,
  LANGUAGE_CODES,
  PERSONA_TYPES,
} from '../../src/domain/types.js';
import { CustomLocationSchema, isUnsafeCityInput } from './locationGuard.js';

/** Zod schema validating a household UserProfile payload. */
export const UserProfileSchema = z
  .object({
    persona: z.enum(PERSONA_TYPES),
    cityId: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .refine((val) => !isUnsafeCityInput(val), 'Unsafe city identifier'),
    language: z.enum(LANGUAGE_CODES),
    householdSize: z.number().int().min(1).max(MAX_HOUSEHOLD_SIZE),
    hasVulnerableMember: z.boolean(),
    monthlyBudgetInr: z.number().min(0).max(MAX_BUDGET_INR),
    roomVolumeM3: z.number().min(MIN_ROOM_VOLUME_M3).max(MAX_ROOM_VOLUME_M3),
    commuteMode: z.enum(COMMUTE_MODES),
    commuteDistanceKm: z.number().min(0).max(MAX_COMMUTE_KM),
    cookingFuel: z.enum(COOKING_FUELS),
    activeHacks: z.array(z.enum(IAQ_HACK_IDS)).max(10),
    rwaHouseholds: z.number().int().min(1).max(MAX_RWA_HOUSEHOLDS).optional(),
    rwaAdoptionRate: z.number().min(0).max(1).optional(),
    customLocation: CustomLocationSchema.optional(),
  })
  .strict();

/** Zod schema validating a wrapped `{ profile, useLiveAq?, snapshotToken? }` plan envelope. */
export const WrappedProfileEnvelopeSchema = z
  .object({
    profile: UserProfileSchema,
    useLiveAq: z.boolean().optional(),
    snapshotToken: z.string().min(20).max(2048).optional(),
  })
  .strict();

/** Zod schema validating a strict `{ profile, expectedVersion? }` preferences envelope. */
export const PreferencesEnvelopeSchema = z
  .object({
    profile: UserProfileSchema,
    expectedVersion: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict();

/** Zod schema validating POST /api/auth/login payload. */
export const LoginSchema = z
  .object({
    email: z.string().trim().email().max(120),
    password: z.string().min(6).max(128),
  })
  .strict();

/** Zod schema validating POST /api/what-if payload. */
export const WhatIfSchema = z
  .object({
    baseline: UserProfileSchema,
    alternative: UserProfileSchema,
  })
  .strict();

/** Zod schema validating POST /api/ai/ask payload. */
export const AiAskSchema = z
  .object({
    question: z.string().trim().min(1).max(MAX_ASSISTANT_QUESTION_LENGTH).optional(),
    query: z.string().trim().min(1).max(MAX_ASSISTANT_QUESTION_LENGTH).optional(),
    city: z
      .string()
      .trim()
      .min(2)
      .max(64)
      .refine((val) => !isUnsafeCityInput(val), 'Unsafe city identifier')
      .optional(),
    language: z.enum(LANGUAGE_CODES).optional(),
    profile: UserProfileSchema.optional(),
    snapshotToken: z.string().min(20).max(2048).optional(),
  })
  .strict()
  .refine((data) => Boolean(data.question ?? data.query), {
    message: 'Either question or query must be provided.',
    path: ['question'],
  });
