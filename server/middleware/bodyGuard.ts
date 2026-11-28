/**
 * Prototype pollution and JSON nesting depth guard middleware.
 */

import type { RequestHandler } from 'express';

const FORBIDDEN_JSON_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const MAX_JSON_DEPTH = 8;

type PayloadViolation = 'depth' | 'forbidden_key';

function inspectArray(items: readonly unknown[], depth: number): PayloadViolation | null {
  for (const item of items) {
    const violation = inspectValue(item, depth + 1);
    if (violation !== null) {
      return violation;
    }
  }
  return null;
}

function inspectObject(obj: object, depth: number): PayloadViolation | null {
  for (const key of Object.getOwnPropertyNames(obj)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      return 'forbidden_key';
    }
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    const violation = inspectValue(descriptor?.value, depth + 1);
    if (violation !== null) {
      return violation;
    }
  }
  return null;
}

function inspectValue(value: unknown, depth: number): PayloadViolation | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if (depth > MAX_JSON_DEPTH) {
    return 'depth';
  }
  if (Array.isArray(value)) {
    return inspectArray(value, depth);
  }
  return inspectObject(value, depth);
}

/**
 * Rejects JSON bodies exceeding depth 8 or containing prototype pollution keys.
 */
export const rejectPrototypePollutionAndDepth: RequestHandler = (req, res, next) => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) {
    next();
    return;
  }
  const violation = inspectValue(body, 1);
  if (violation === 'depth') {
    res.status(413).json({
      error: 'PAYLOAD_TOO_LARGE', message: 'JSON payload exceeds maximum nesting depth.',
    });
    return;
  }
  if (violation === 'forbidden_key') {
    res.status(400).json({ error: 'INVALID_JSON', message: 'Invalid property name in JSON payload.' });
    return;
  }
  next();
};
