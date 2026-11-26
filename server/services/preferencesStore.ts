/**
 * Bounded in-memory LRU store for authenticated user household preferences.
 */

import type { UserProfile } from '../../src/domain/types.js';
import { createLruCache } from '../cache/lruCache.js';

const PREFERENCES_MAX_ENTRIES = 200;
const PREFERENCES_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PREFIX = 'prefs:';

const preferencesCache = createLruCache<UserProfile>(
  PREFERENCES_MAX_ENTRIES,
  PREFERENCES_TTL_MS,
);

function buildPreferenceKey(userId: string): string {
  return `${KEY_PREFIX}${userId.trim()}`;
}

/**
 * Retrieves saved household profile preferences for an authenticated user ID.
 */
export function getUserPreferences(userId: string): UserProfile | undefined {
  const normalized = userId.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  return preferencesCache.get(buildPreferenceKey(normalized));
}

/**
 * Persists household profile preferences for an authenticated user ID.
 */
export function setUserPreferences(userId: string, profile: UserProfile): void {
  const normalized = userId.trim();
  if (normalized.length === 0) {
    return;
  }
  preferencesCache.set(buildPreferenceKey(normalized), profile);
}
