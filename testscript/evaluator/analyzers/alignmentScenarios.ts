/**
 * Scenario S1-S5 execution helpers for alignmentRuntimeAnalyzer.
 */

import type { UserProfile } from '../../../src/domain/types.js';
import { isPlainRecord, round2 } from '../utils.js';

const DEVANAGARI_RE = /[\u0900-\u097F]/;

/** Result of a single live alignment scenario probe. */
export interface ScenarioOutcome {
  readonly passed: boolean;
  readonly missingBeforeAfter?: boolean;
  readonly evidence: string;
  readonly fix: string;
}

function okOutcome(id: string): ScenarioOutcome {
  return { passed: true, evidence: `${id} passed.`, fix: '' };
}

function failOutcome(
  evidence: string,
  fix: string,
  missingBeforeAfter?: boolean,
): ScenarioOutcome {
  return missingBeforeAfter === undefined
    ? { passed: false, evidence, fix }
    : { passed: false, missingBeforeAfter, evidence, fix };
}

async function readJsonOrNull(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch (err: unknown) {
    // Non-JSON or empty error bodies are treated as null in scenario probes.
    void err;
    return null;
  }
}

async function fetchJson(
  url: string,
  init?: RequestInit,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  try {
    const res = await fetch(url, init);
    return { ok: res.ok, status: res.status, body: await readJsonOrNull(res) };
  } catch (err: unknown) {
    void err;
    return { ok: false, status: 0, body: null };
  }
}

async function postJsonRecord(
  baseUrl: string,
  route: string,
  payload: unknown,
): Promise<Record<string, unknown> | null> {
  const { ok, body } = await fetchJson(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return ok && isPlainRecord(body) ? body : null;
}

function hasRequiredCitations(citations: unknown): boolean {
  if (!isPlainRecord(citations)) return false;
  const keys = Object.keys(citations);
  return (
    keys.some((k) => k.startsWith('CALC:')) &&
    keys.some((k) => k.startsWith('AQ:')) &&
    typeof citations['CALC:INDOOR_TARGET'] === 'string' &&
    typeof citations['SCI:PLANTS_VS_HEPA'] === 'string'
  );
}

function readNumField(rec: unknown, key: string): number {
  if (!isPlainRecord(rec)) return 0;
  const val = rec[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : 0;
}

function isS1MetricsValid(
  data: Record<string, unknown>,
  report: Record<string, unknown>,
  exp: Record<string, unknown>,
): { readonly ok: boolean; readonly doseOk: boolean } {
  const doseOk =
    readNumField(exp, 'baselineInhaledUgPerDay') > readNumField(exp, 'optimizedInhaledUgPerDay');
  const indoorOk =
    readNumField(exp, 'baselineIndoorPm25') > readNumField(exp, 'optimizedIndoorPm25');
  const winVal = exp['optimalVentilationWindow'];
  const winOk = typeof winVal === 'string' && winVal.trim().length > 0;
  const citeOk = hasRequiredCitations(data['citations']) || hasRequiredCitations(report['citations']);
  const routineOk = Array.isArray(data['routine']) && data['routine'].length > 0;
  return { ok: doseOk && indoorOk && winOk && citeOk && routineOk, doseOk };
}

function evaluateScenario1Data(data: Record<string, unknown> | null): ScenarioOutcome {
  if (data === null || !isPlainRecord(data['report']) || !isPlainRecord(data['report']['exposure'])) {
    return failOutcome(
      'S1 POST /api/plan failed for Delhi Anand Vihar young family.',
      'Ensure POST /api/plan returns 200 with report, routine, and citations.',
      true,
    );
  }
  const { ok, doseOk } = isS1MetricsValid(data, data['report'], data['report']['exposure']);
  if (ok) return okOutcome('S1');
  return failOutcome(
    'S1 failed exposure reduction, ventilation window, citations, or routine check.',
    'Return before/after ug/day, indoor PM2.5, ventilation window, CALC/AQ citations, routine.',
    !doseOk,
  );
}

const BASE_DELHI_PROFILE: UserProfile = {
  persona: 'young_family',
  cityId: 'delhi_anand_vihar',
  language: 'en',
  householdSize: 4,
  hasVulnerableMember: true,
  monthlyBudgetInr: 4000,
  roomVolumeM3: 45,
  commuteMode: 'petrol_car',
  commuteDistanceKm: 18,
  cookingFuel: 'lpg',
  activeHacks: ['window_sealing', 'n95_mask'],
};

/** S1: Delhi Anand Vihar young-family reduction, ventilation window, citations, and routine. */
export async function runScenario1(baseUrl: string): Promise<ScenarioOutcome> {
  const data = await postJsonRecord(baseUrl, '/api/plan', BASE_DELHI_PROFILE);
  return evaluateScenario1Data(data);
}

/** S2: Lucknow Hindi sensitive household low-cost IAQ ranking and Devanagari summary. */
export async function runScenario2(baseUrl: string): Promise<ScenarioOutcome> {
  const profile: UserProfile = {
    persona: 'sensitive_household',
    cityId: 'lucknow_gomtinagar',
    language: 'hi',
    householdSize: 2,
    hasVulnerableMember: true,
    monthlyBudgetInr: 1200,
    roomVolumeM3: 36,
    commuteMode: 'wfh_walk',
    commuteDistanceKm: 2,
    cookingFuel: 'lpg',
    activeHacks: ['window_sealing', 'wet_mopping'],
  };
  const data = await postJsonRecord(baseUrl, '/api/plan', profile);
  if (data === null || !isPlainRecord(data['report'])) {
    return failOutcome(
      'S2 POST /api/plan failed for Lucknow Hindi elderly couple.',
      'Support lucknow_gomtinagar and language hi in POST /api/plan.',
    );
  }
  const hacks = Array.isArray(data['report']['recommendedHacks'])
    ? data['report']['recommendedHacks'].filter((h): h is string => typeof h === 'string')
    : [];
  const lowCostIdx = hacks.findIndex(
    (h) => h === 'window_sealing' || h === 'wet_mopping' || h === 'ventilation_window',
  );
  const hepaIdx = hacks.indexOf('hepa_purifier');
  const rankedOk = lowCostIdx !== -1 && (hepaIdx === -1 || lowCostIdx < hepaIdx);
  const locSum = data['localizedSummary'];
  const hindiOk = typeof locSum === 'string' && DEVANAGARI_RE.test(locSum);
  return rankedOk && hindiOk
    ? okOutcome('S2')
    : failOutcome('S2 failed low-cost hack ranking or Hindi Devanagari localizedSummary.',
        'Rank low-cost hacks before HEPA purifiers and return Hindi summary for hi.');
}

function makeRwaProfile(rwaHouseholds: number): UserProfile {
  return {
    persona: 'rwa_coordinator',
    cityId: 'gurugram_dlf',
    language: 'en',
    householdSize: 3,
    hasVulnerableMember: false,
    monthlyBudgetInr: 5000,
    roomVolumeM3: 50,
    commuteMode: 'carpool',
    commuteDistanceKm: 15,
    cookingFuel: 'lpg',
    activeHacks: ['window_sealing', 'ventilation_window'],
    rwaHouseholds,
    rwaAdoptionRate: 0.6,
  };
}

function extractEmissionsRecord(
  res: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (res === null || !isPlainRecord(res['report'])) return null;
  return isPlainRecord(res['report']['emissions']) ? res['report']['emissions'] : null;
}

/** S3: Gurugram RWA 90 -> 180 flat linear CO2e scaling. */
export async function runScenario3(baseUrl: string): Promise<ScenarioOutcome> {
  const e90 = extractEmissionsRecord(await postJsonRecord(baseUrl, '/api/plan', makeRwaProfile(90)));
  const e180 = extractEmissionsRecord(await postJsonRecord(baseUrl, '/api/plan', makeRwaProfile(180)));
  if (e90 === null || e180 === null) {
    return failOutcome('S3 POST /api/plan failed for Gurugram RWA scaling check.',
      'Support rwa_coordinator and rwaHouseholds in POST /api/plan.');
  }
  const baseCo2 = readNumField(e90, 'communityCo2eAvoidedKgPerMonth');
  const scaledCo2 = readNumField(e180, 'communityCo2eAvoidedKgPerMonth');
  const ratio = baseCo2 > 0 ? scaledCo2 / baseCo2 : 0;
  return ratio >= 1.9 && ratio <= 2.1
    ? okOutcome('S3')
    : failOutcome(`S3 RWA CO2e scaling ratio ${String(round2(ratio))} outside [1.9, 2.1].`,
        'Scale communityCo2eAvoidedKgPerMonth linearly with rwaHouseholds.');
}

/** S4: What-if commute & fuel switch positive CO2e/PM2.5 avoidance. */
export async function runScenario4(baseUrl: string): Promise<ScenarioOutcome> {
  const baseline: UserProfile = {
    ...BASE_DELHI_PROFILE,
    hasVulnerableMember: false,
    commuteDistanceKm: 20,
    cookingFuel: 'biomass_chulha',
    activeHacks: ['window_sealing'],
  };
  const alternative: UserProfile = { ...baseline, commuteMode: 'metro_bus', cookingFuel: 'induction' };
  const data = await postJsonRecord(baseUrl, '/api/what-if', { baseline, alternative });
  if (data === null || !isPlainRecord(data['delta']) || !isPlainRecord(data['explanation'])) {
    return failOutcome('S4 POST /api/what-if failed for commute/cooking switch.',
      'Implement POST /api/what-if returning delta and explanation.');
  }
  const enText = data['explanation']['en'];
  const ok =
    readNumField(data['delta'], 'co2eAvoidedGramsPerDay') > 0 &&
    readNumField(data['delta'], 'pm25AvoidedMgPerDay') > 0 &&
    typeof enText === 'string' &&
    enText.trim().length > 0;
  return ok
    ? okOutcome('S4')
    : failOutcome('S4 what-if delta did not show positive CO2e/PM2.5 avoidance and explanation.en.',
        'Compute positive CO2e/PM2.5 deltas and non-empty explanation.en in /api/what-if.');
}

/** S5: Pan-India search, bounded lat/lon AQI lookup, and out-of-bounds rejection. */
export async function runScenario5(baseUrl: string): Promise<ScenarioOutcome> {
  const search = await fetchJson(`${baseUrl}/api/locations/search?q=Jaipur`);
  const custom = await fetchJson(`${baseUrl}/api/aqi?lat=28.49&lon=77.09`);
  const outside = await fetchJson(`${baseUrl}/api/aqi?lat=51.5&lon=-0.1`);
  const validBody =
    isPlainRecord(custom.body) &&
    typeof custom.body['cpcbAqi'] === 'number' &&
    typeof custom.body['dataSource'] === 'string' &&
    typeof custom.body['fetchedAt'] === 'string';
  return search.status === 200 && custom.status === 200 && validBody && outside.status === 400
    ? okOutcome('S5')
    : failOutcome(`S5 failed (${search.status}/${custom.status}/${outside.status}).`,
        'Support /api/locations/search and /api/aqi India-bounded lat/lon.');
}
