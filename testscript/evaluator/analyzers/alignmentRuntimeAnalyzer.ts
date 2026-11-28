/**
 * Runtime alignment analyzer for SmogWise Virtual API scenarios.
 */

import path from 'node:path';
import type { Server } from 'node:http';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import {
  closeServerSafely,
  makeDeduction,
  resolveExpressApp,
  round2,
  safeDynamicImport,
  startEphemeralServer,
} from '../utils.js';
import {
  runScenario1,
  runScenario2,
  runScenario3,
  runScenario4,
  runScenario5,
  type ScenarioOutcome,
} from './alignmentScenarios.js';

const MAX_DETERMINISTIC = 12.0;
const SCENARIO_POINTS = round2(12 / 5);
const CAP_SCORE = 15.0;

function makeMissingServerResult(reason: string): AnalyzerResult {
  return {
    criterion: 'alignment',
    deterministicScore: 0,
    maxDeterministic: MAX_DETERMINISTIC,
    capApplied: CAP_SCORE,
    deductions: [
      makeDeduction(
        'alignment',
        MAX_DETERMINISTIC,
        reason,
        'Export createApp() from server/app.ts implementing /api/plan and /api/what-if.',
      ),
    ],
    metrics: { serverLoaded: false },
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
  return s1?.missingBeforeAfter === true ? { ...base, capApplied: CAP_SCORE } : base;
}

/** Runs live alignment checks S1-S5 against an ephemeral Express server. */
export async function runAlignmentRuntimeAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const mod = await safeDynamicImport(path.join(rootDir, 'server', 'app.ts'));
  const app = resolveExpressApp(mod);
  if (app === null) {
    return makeMissingServerResult('server/app.ts or createApp is unavailable.');
  }
  let server: Server | null = null;
  try {
    const started = await startEphemeralServer(app);
    server = started.server;
    const { baseUrl } = started;
    const outcomes = await Promise.all([
      runScenario1(baseUrl),
      runScenario2(baseUrl),
      runScenario3(baseUrl),
      runScenario4(baseUrl),
      runScenario5(baseUrl),
    ]);
    return buildResult(outcomes);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'Unknown runtime probe error';
    return makeMissingServerResult(`Runtime alignment probes unavailable: ${reason}`);
  } finally {
    await closeServerSafely(server);
  }
}
