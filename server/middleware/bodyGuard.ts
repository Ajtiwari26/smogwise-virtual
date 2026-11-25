/**
 * Prototype pollution and JSON nesting depth guard middleware.
 */

import type { RequestHandler } from 'express';

export const FORBIDDEN_JSON_KEYS: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const MAX_JSON_DEPTH = 8;

type PayloadViolation = 'depth' | 'forbidden_key';

function inspectValue(value: unknown, depth: number): PayloadViolation | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  if (depth > MAX_JSON_DEPTH) {
    return 'depth';
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const violation = inspectValue(item, depth + 1);
      if (violation !== null) {
        return violation;
      }
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.getOwnPropertyNames(record)) {
    if (FORBIDDEN_JSON_KEYS.has(key)) {
      return 'forbidden_key';
    }
    const violation = inspectValue(record[key], depth + 1);
    if (violation !== null) {
      return violation;
    }
  }
  return null;
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
    res.status(400).json({ error: 'JSON payload exceeds maximum nesting depth.' });
    return;
  }
  if (violation === 'forbidden_key') {
    res.status(400).json({ error: 'Invalid property name in JSON payload.' });
    return;
  }
  next();
};
