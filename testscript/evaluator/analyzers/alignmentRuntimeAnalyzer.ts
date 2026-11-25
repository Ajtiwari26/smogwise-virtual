/**
 * Runtime alignment analyzer for SmogWise Virtual API scenarios.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { DeterministicReport, IAQHackId, UserProfile } from '../../../src/domain/types.js';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import { makeDeduction, round2, safeDynamicImport } from '../utils.js';

const MAX_DETERMINISTIC = 12.0;
const SCENARIO_POINTS = round2(12 / 5);
const CAP_SCORE = 15.0;
const DEVANAGARI_RE = /[\u0900-\u097F]/;

interface AppModule {
  readonly createApp?: () => unknown;
}

interface PlanResponse {
  readonly report: DeterministicReport;
  readonly routine: readonly unknown[];
  readonly iaqHacks: readonly { readonly id: string; readonly monthlyCostInr?: number }[];
  readonly localizedSummary: string;
  readonly citations: Readonly<Record<string, string>>;
}

interface WhatIfDelta {
  readonly doseReductionUgPerDay: number;
  readonly co2eAvoidedGramsPerDay: number;
  readonly pm25AvoidedMgPerDay: number;
  readonly monthlyNetSavingsInr: number;
}

interface WhatIfResponse {
  readonly delta: WhatIfDelta;
  readonly explanation: { readonly en: string; readonly hi: string };
  readonly citations: Readonly<Record<string, string>>;
}

interface ScenarioOutcome {
  readonly passed: boolean;
  readonly missingBeforeAfter?: boolean;
  readonly evidence: string;
  readonly fix: string;
}

function makeMissingServerResult(): AnalyzerResult {
  return {
    criterion: 'alignment',
    deterministicScore: 0,
    maxDeterministic: MAX_DETERMINISTIC,
    capApplied: CAP_SCORE,
    deductions: [
      makeDeduction(
        'alignment',
        MAX_DETERMINISTIC,
        'server/app.ts not implemented or missing createApp export.',
        'Export createApp() from server/app.ts implementing /api/plan and /api/what-if.',
      ),
    ],
    metrics: { serverLoaded: false },
  };
}

function startEphemeralServer(app: unknown): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const listener = app as http.RequestListener;
    const server = http.createServer(listener);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo | null;
      if (addr === null) {
        reject(new Error('Failed to bind ephemeral port.'));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${String(addr.port)}` });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function postJson<T>(baseUrl: string, route: string, payload: unknown): Promise<T | null> {
  try {
    const res = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function hasRequiredCitations(citations: Readonly<Record<string, string>>): boolean {
  const keys = Object.keys(citations);
  const hasCalc = keys.some((k) => k.startsWith('CALC:'));
  const hasAq = keys.some((k) => k.startsWith('AQ:'));
  const hasTarget = typeof citations['CALC:INDOOR_TARGET'] === 'string';
  const hasSci = typeof citations['SCI:PLANTS_VS_HEPA'] === 'string';
  return hasCalc && hasAq && hasTarget && hasSci;
}

async function getJsonStatus(
  baseUrl: string,
  route: string,
): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(`${baseUrl}${route}`);
    const body: unknown = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

function isValidCustomAqi(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) {
    return false;
  }
  const rec = body as Record<string, unknown>;
  return (
    typeof rec['cpcbAqi'] === 'number' &&
    typeof rec['dataSource'] === 'string' &&
    typeof rec['fetchedAt'] === 'string'
  );
}

async function runScenario5(baseUrl: string): Promise<ScenarioOutcome> {
  const search = await getJsonStatus(baseUrl, '/api/locations/search?q=Jaipur');
  const custom = await getJsonStatus(baseUrl, '/api/aqi?lat=28.49&lon=77.09');
  const outside = await getJsonStatus(baseUrl, '/api/aqi?lat=51.5&lon=-0.1');
  const ok = search.status === 200 && custom.status === 200 &&
    isValidCustomAqi(custom.body) && outside.status === 400;
  if (ok) {
    return { passed: true, evidence: 'S5 passed.', fix: '' };
  }
  return {
    passed: false,
    evidence: `S5 failed (${search.status}/${custom.status}/${outside.status}).`,
    fix: 'Support /api/locations/search and /api/aqi India-bounded lat/lon.',
  };
}

async function runScenario1(baseUrl: string): Promise<ScenarioOutcome> {
  const profile: UserProfile = {
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
  const data = await postJson<PlanResponse>(baseUrl, '/api/plan', profile);
  if (data === null) {
    return {
      passed: false,
      missingBeforeAfter: true,
      evidence: 'S1 POST /api/plan failed for Delhi Anand Vihar young family.',
      fix: 'Ensure POST /api/plan returns 200 with report, routine, and citations.',
    };
  }
  const exp = data.report.exposure;
  const doseOk = exp.baselineInhaledUgPerDay > exp.optimizedInhaledUgPerDay;
  const indoorOk = exp.baselineIndoorPm25 > exp.optimizedIndoorPm25;
  const winOk = exp.optimalVentilationWindow.trim().length > 0;
  const citeOk =
    hasRequiredCitations(data.citations) || hasRequiredCitations(data.report.citations);
  const routineOk = Array.isArray(data.routine) && data.routine.length > 0;
  if (doseOk && indoorOk && winOk && citeOk && routineOk) {
    return { passed: true, evidence: 'S1 passed.', fix: '' };
  }
  return {
    passed: false,
    missingBeforeAfter: !doseOk,
    evidence: 'S1 failed exposure reduction, ventilation window, citations, or routine check.',
    fix: 'Return before/after ug/day, indoor PM2.5, ventilation window, CALC/AQ citations, routine.',
  };
}

function ranksLowCostFirst(hacks: readonly IAQHackId[]): boolean {
  const lowCostIdx = hacks.findIndex(
    (h) => h === 'window_sealing' || h === 'wet_mopping' || h === 'ventilation_window',
  );
  const hepaIdx = hacks.indexOf('hepa_purifier');
  if (lowCostIdx === -1) {
    return false;
  }
  return hepaIdx === -1 || lowCostIdx < hepaIdx;
}

async function runScenario2(baseUrl: string): Promise<ScenarioOutcome> {
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
  const data = await postJson<PlanResponse>(baseUrl, '/api/plan', profile);
  if (data === null) {
    return {
      passed: false,
      evidence: 'S2 POST /api/plan failed for Lucknow Hindi elderly couple.',
      fix: 'Support lucknow_gomtinagar and language hi in POST /api/plan.',
    };
  }
  const rankedOk = ranksLowCostFirst(data.report.recommendedHacks);
  const hindiOk = DEVANAGARI_RE.test(data.localizedSummary);
  if (rankedOk && hindiOk) {
    return { passed: true, evidence: 'S2 passed.', fix: '' };
  }
  return {
    passed: false,
    evidence: 'S2 failed low-cost hack ranking or Hindi Devanagari localizedSummary.',
    fix: 'Rank low-cost hacks before HEPA purifiers and return Hindi summary for hi.',
  };
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

async function runScenario3(baseUrl: string): Promise<ScenarioOutcome> {
  const res90 = await postJson<PlanResponse>(baseUrl, '/api/plan', makeRwaProfile(90));
  const res180 = await postJson<PlanResponse>(baseUrl, '/api/plan', makeRwaProfile(180));
  if (res90 === null || res180 === null) {
    return {
      passed: false,
      evidence: 'S3 POST /api/plan failed for Gurugram RWA scaling check.',
      fix: 'Support rwa_coordinator and rwaHouseholds in POST /api/plan.',
    };
  }
  const baseCo2 = res90.report.emissions.communityCo2eAvoidedKgPerMonth;
  const scaledCo2 = res180.report.emissions.communityCo2eAvoidedKgPerMonth;
  const ratio = baseCo2 > 0 ? scaledCo2 / baseCo2 : 0;
  if (ratio >= 1.9 && ratio <= 2.1) {
    return { passed: true, evidence: 'S3 passed.', fix: '' };
  }
  return {
    passed: false,
    evidence: `S3 RWA CO2e scaling ratio ${String(round2(ratio))} outside [1.9, 2.1].`,
    fix: 'Scale communityCo2eAvoidedKgPerMonth linearly with rwaHouseholds.',
  };
}

async function runScenario4(baseUrl: string): Promise<ScenarioOutcome> {
  const baseline: UserProfile = {
    persona: 'young_family',
    cityId: 'delhi_anand_vihar',
    language: 'en',
    householdSize: 4,
    hasVulnerableMember: false,
    monthlyBudgetInr: 4000,
    roomVolumeM3: 45,
    commuteMode: 'petrol_car',
    commuteDistanceKm: 20,
    cookingFuel: 'biomass_chulha',
    activeHacks: ['window_sealing'],
  };
  const alternative: UserProfile = {
    ...baseline,
    commuteMode: 'metro_bus',
    cookingFuel: 'induction',
  };
  const data = await postJson<WhatIfResponse>(baseUrl, '/api/what-if', { baseline, alternative });
  if (data === null) {
    return {
      passed: false,
      evidence: 'S4 POST /api/what-if failed for commute/cooking switch.',
      fix: 'Implement POST /api/what-if returning delta and explanation.',
    };
  }
  const ok =
    data.delta.co2eAvoidedGramsPerDay > 0 &&
    data.delta.pm25AvoidedMgPerDay > 0 &&
    data.explanation.en.trim().length > 0;
  if (ok) {
    return { passed: true, evidence: 'S4 passed.', fix: '' };
  }
  return {
    passed: false,
    evidence: 'S4 what-if delta did not show positive CO2e/PM2.5 avoidance and explanation.en.',
    fix: 'Compute positive CO2e/PM2.5 deltas and non-empty explanation.en in /api/what-if.',
  };
}

function buildResult(outcomes: readonly ScenarioOutcome[]): AnalyzerResult {
  const deductions: DeductionItem[] = [];
  let score = 0;
  for (const outcome of outcomes) {
    if (outcome.passed) {
      score += SCENARIO_POINTS;
    } else {
      deductions.push(makeDeduction('alignment', SCENARIO_POINTS, outcome.evidence, outcome.fix));
    }
  }
  const s1 = outcomes[0];
  const base: AnalyzerResult = {
    criterion: 'alignment',
    deterministicScore: round2(score),
    maxDeterministic: MAX_DETERMINISTIC,
    deductions,
    metrics: {
      serverLoaded: true,
      scenariosPassed: outcomes.filter((o) => o.passed).length,
      scenariosTotal: outcomes.length,
    },
  };
  if (s1?.missingBeforeAfter === true) {
    return { ...base, capApplied: CAP_SCORE };
  }
  return base;
}

/**
 * Runs live alignment checks against the ephemeral Express server.
 */
export async function runAlignmentRuntimeAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const appPath = path.join(rootDir, 'server', 'app.ts');
  const mod = await safeDynamicImport<AppModule>(appPath);
  if (mod === null || typeof mod.createApp !== 'function') {
    return makeMissingServerResult();
  }
  const { server, baseUrl } = await startEphemeralServer(mod.createApp());
  try {
    const outcomes = [
      await runScenario1(baseUrl),
      await runScenario2(baseUrl),
      await runScenario3(baseUrl),
      await runScenario4(baseUrl),
      await runScenario5(baseUrl),
    ];
    return buildResult(outcomes);
  } finally {
    await closeServer(server);
  }
}
