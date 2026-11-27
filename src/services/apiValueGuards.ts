/** Runtime validators for nested values returned by the SmogWise API. */

import { isPlainRecord } from '../domain/domainUtils.js';
import {
  COMMUTE_MODES,
  COOKING_FUELS,
  IAQ_HACK_IDS,
  LANGUAGE_CODES,
  PERSONA_TYPES,
} from '../domain/types.js';

/** Checks that the specified fields contain strings. */
export function hasStrings(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => typeof record[key] === 'string');
}

/** Checks that the specified fields contain finite numbers. */
export function hasNumbers(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => Number.isFinite(record[key]));
}

/** Tests membership in a set of allowed string values. */
export function isOneOf(value: unknown, options: readonly string[]): boolean {
  return options.some((option) => option === value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidCoordinateFields(record: Record<string, unknown>): boolean {
  const { lat, lon } = record;
  return typeof lat === 'number' && Math.abs(lat) <= 90 &&
    typeof lon === 'number' && Math.abs(lon) <= 180;
}

/** Validates a geocoding result returned by location search. */
export function isLocationItem(record: Record<string, unknown>): boolean {
  return isNonEmptyString(record['id']) && isNonEmptyString(record['name']) &&
    typeof record['state'] === 'string' && isValidCoordinateFields(record);
}

/** Validates a preset or coordinate-based city returned with AQ data. */
export function isValidCity(value: unknown): boolean {
  return isPlainRecord(value) && isLocationItem(value) &&
    typeof value['nameHi'] === 'string' &&
    hasNumbers(value, 'baselinePm25', 'baselinePm10', 'baselineNo2') &&
    isOneOf(value['grapStage'], ['NONE', 'GRAP_I', 'GRAP_II', 'GRAP_III', 'GRAP_IV']);
}

/** Validates the AQ source, CPCB AQI band, and dominant pollutant shared by AQ envelopes. */
export function isAqMetadata(record: Record<string, unknown>): boolean {
  return Number.isFinite(record['cpcbAqi']) &&
    isOneOf(record['dataSource'], ['live_open_meteo', 'city_preset']) &&
    isOneOf(record['aqiBand'], ['good', 'satisfactory', 'moderate', 'poor', 'very_poor', 'severe']) &&
    isOneOf(record['dominantPollutant'], ['PM2.5', 'PM10', 'NO2']) &&
    hasOptionalStrings(record, 'observedAt', 'fallbackStationName') &&
    hasOptionalNumbers(record, 'fallbackDistanceKm');
}

/** Checks optional string fields when present. */
export function hasOptionalStrings(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => record[key] === undefined || typeof record[key] === 'string');
}

/** Checks optional finite numeric fields when present. */
export function hasOptionalNumbers(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => record[key] === undefined || Number.isFinite(record[key]));
}

/** Validates the AQ measurement override used for coordinate and city lookups. */
export function isLiveAq(value: unknown): boolean {
  return isPlainRecord(value) &&
    Number.isFinite(value['pm25']) &&
    hasOptionalNumbers(value, 'pm10', 'no2', 'cpcbAqi', 'fallbackDistanceKm') &&
    hasOptionalStrings(value, 'sourceLabel', 'observedAt', 'fallbackStationName') &&
    (value['dominantPollutant'] === undefined ||
      isOneOf(value['dominantPollutant'], ['PM2.5', 'PM10', 'NO2']));
}

/** Validates the public user object returned by login and session. */
export function isAuthUser(value: unknown): boolean {
  return isPlainRecord(value) &&
    hasStrings(value, 'id', 'name', 'defaultCityId') &&
    typeof value['email'] === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value['email']) &&
    isOneOf(value['personaId'], PERSONA_TYPES) &&
    isOneOf(value['defaultLang'], LANGUAGE_CODES);
}

function isCustomLocation(value: unknown): boolean {
  return isPlainRecord(value) && isNonEmptyString(value['name']) &&
    hasOptionalStrings(value, 'state') && isValidCoordinateFields(value);
}

function hasProfileChoices(profile: Record<string, unknown>): boolean {
  return isOneOf(profile['persona'], PERSONA_TYPES) &&
    isOneOf(profile['language'], LANGUAGE_CODES) &&
    isOneOf(profile['commuteMode'], COMMUTE_MODES) &&
    isOneOf(profile['cookingFuel'], COOKING_FUELS) &&
    isIaqHackList(profile['activeHacks']);
}

/** Validates a list of supported IAQ hack IDs. */
export function isIaqHackList(value: unknown): boolean {
  return Array.isArray(value) && value.every((id: unknown) => isOneOf(id, IAQ_HACK_IDS));
}

/** Validates a returned household profile including optional RWA and coordinate fields. */
export function isProfile(value: unknown): boolean {
  return isPlainRecord(value) &&
    isNonEmptyString(value['cityId']) &&
    hasProfileChoices(value) &&
    hasNumbers(value, 'householdSize', 'monthlyBudgetInr', 'roomVolumeM3', 'commuteDistanceKm') &&
    typeof value['hasVulnerableMember'] === 'boolean' &&
    hasOptionalNumbers(value, 'rwaHouseholds', 'rwaAdoptionRate') &&
    (value['customLocation'] === undefined || isCustomLocation(value['customLocation']));
}
