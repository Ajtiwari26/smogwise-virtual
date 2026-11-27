/**
 * Deterministic security analyzer for SmogWise Virtual.
 * Evaluates secret hygiene, npm audit, Express security headers,
 * input/SSRF validation, and prompt-injection/XSS defenses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { AnalyzerResult, DeductionItem } from '../types.js';
import {
  clamp,
  closeServerSafely,
  listSourceFiles,
  makeDeduction,
  resolveExpressApp,
  round2,
  runShellCapture,
  safeDynamicImport,
  startEphemeralServer,
} from '../utils.js';
import {
  probeHeadersCorsRateLimit,
  probeInputAndSsrf,
  probePromptAttacks,
} from './securityProbes.js';

const MAX_DETERMINISTIC = 11.0;
const LEAK_CAP = 5.0;
const CRITERION = 'security' as const;

function buildSecretPatterns(): readonly RegExp[] {
  return [
    new RegExp(['AIza', '[0-9A-Za-z_-]{35}'].join('')),
    new RegExp(['sk', '-', '[A-Za-z0-9]{20,}'].join('')),
    new RegExp(['ghp', '_', '[A-Za-z0-9]{36}'].join('')),
    new RegExp(['AKIA', '[0-9A-Z]{16}'].join('')),
    new RegExp(['-----BEGIN ', '(?:RSA |EC )?PRIVATE KEY-----'].join('')),
    new RegExp(['VITE_', '(?:GEMINI|OPENAI|SECRET|TOKEN|KEY)', '\\s*='].join('')),
  ];
}

function fileHasSecret(filePath: string, patterns: readonly RegExp[]): boolean {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return patterns.some((re) => re.test(content));
  } catch (err: unknown) {
    void err;
    return false;
  }
}

function scanSecrets(
  rootDir: string,
  deductions: DeductionItem[],
): { readonly leakedFiles: readonly string[]; readonly deduction: number } {
  const patterns = buildSecretPatterns();
  const candidates = listSourceFiles(rootDir);
  const envExample = path.join(rootDir, '.env.example');
  if (fs.existsSync(envExample)) candidates.push(envExample);
  const leakedFiles = candidates
    .filter((f) => fileHasSecret(f, patterns))
    .map((f) => path.relative(rootDir, f));
  if (leakedFiles.length === 0) return { leakedFiles, deduction: 0 };
  deductions.push(
    makeDeduction(
      CRITERION,
      3.0,
      `Potential secret/key exposure in: ${leakedFiles.join(', ')}`,
      'Remove hardcoded secrets and never expose keys via VITE_ env vars.',
    ),
  );
  return { leakedFiles, deduction: 3.0 };
}

const auditCount = z.number().int().nonnegative();
const AuditReportSchema = z.object({
  auditReportVersion: z.literal(2),
  error: z.never().optional(),
  metadata: z.object({
    vulnerabilities: z.object({
      info: auditCount,
      low: auditCount,
      moderate: auditCount,
      high: auditCount,
      critical: auditCount,
      total: auditCount,
    }).refine(({ info, low, moderate, high, critical, total }) =>
      total === info + low + moderate + high + critical,
    ),
  }),
});

function parseAuditCounts(stdout: string, code: number) {
  try {
    const parsed: unknown = JSON.parse(stdout);
    const report = AuditReportSchema.safeParse(parsed);
    if (!report.success) return null;
    const counts = report.data.metadata.vulnerabilities;
    return code === (counts.total === 0 ? 0 : 1) ? counts : null;
  } catch (err: unknown) {
    void err;
    return null;
  }
}

async function runNpmAudit(rootDir: string, deductions: DeductionItem[]) {
  const args = ['audit', '--omit=dev', '--json', '--audit-level=info'];
  const res = await runShellCapture('npm', args, rootDir);
  const counts = parseAuditCounts(res.stdout, res.code);
  if (counts === null) {
    deductions.push(
      makeDeduction(
        CRITERION,
        3.0,
        `npm audit did not return a valid vulnerability report (exit ${String(res.code)}).`,
        'Restore registry access and run npm audit --omit=dev --json.',
      ),
    );
    return { critical: 'unverified', high: 'unverified', deduction: 3.0 };
  }
  const { critical, high } = counts;
  const deduction = clamp(round2(critical * 1.5 + high * 0.75), 0, 3.0);
  if (deduction > 0) {
    deductions.push(
      makeDeduction(
        CRITERION,
        deduction,
        `npm audit found ${critical} critical and ${high} high prod vulns.`,
        'Upgrade vulnerable production dependencies and run npm audit fix.',
      ),
    );
  }
  return { critical, high, deduction };
}

async function runLiveServerProbes(rootDir: string, deductions: DeductionItem[]): Promise<number> {
  const mod = await safeDynamicImport(path.join(rootDir, 'server', 'app.ts'));
  const app = resolveExpressApp(mod);
  if (app === null) {
    deductions.push(
      makeDeduction(
        CRITERION,
        8.0,
        'server/app.ts or createApp() not found; live probes unrun.',
        'Export createApp() from server/app.ts to enable live security probes.',
      ),
    );
    return 8.0;
  }
  const { server, port } = await startEphemeralServer(app);
  try {
    const p1 = await probeHeadersCorsRateLimit(port, deductions);
    const p2 = await probeInputAndSsrf(port, deductions);
    const p3 = await probePromptAttacks(port, deductions);
    return clamp(round2(p1 + p2 + p3), 0, 8.0);
  } finally {
    await closeServerSafely(server);
  }
}

/** Runs deterministic security checks for SmogWise Virtual. */
export async function runSecurityAnalyzer(rootDir: string): Promise<AnalyzerResult> {
  const deductions: DeductionItem[] = [];
  const secretRes = scanSecrets(rootDir, deductions);
  const auditRes = await runNpmAudit(rootDir, deductions);
  const staticLost = clamp(round2(secretRes.deduction + auditRes.deduction), 0, 3.0);
  const liveLost = await runLiveServerProbes(rootDir, deductions);
  const raw = clamp(round2(MAX_DETERMINISTIC - staticLost - liveLost), 0, MAX_DETERMINISTIC);
  const capApplied = secretRes.leakedFiles.length > 0 ? LEAK_CAP : undefined;
  const finalScore = capApplied !== undefined ? Math.min(raw, capApplied) : raw;

  return {
    criterion: CRITERION,
    deterministicScore: round2(finalScore),
    maxDeterministic: MAX_DETERMINISTIC,
    ...(capApplied !== undefined ? { capApplied } : {}),
    deductions,
    metrics: {
      leakedSecretFiles: secretRes.leakedFiles.length,
      auditCritical: auditRes.critical,
      auditHigh: auditRes.high,
      staticDeduction: staticLost,
      liveProbeDeduction: liveLost,
    },
  };
}
