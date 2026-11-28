/**
 * Shared helper utilities for the SmogWise Virtual hybrid evaluator.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CriterionKey, DeductionItem } from './types.js';

const DEFAULT_EXTS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx'];

const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.etta',
  '.code-review-graph',
  '.git',
  '.vitest',
]);

const SKIP_REL_PATHS: ReadonlySet<string> = new Set(['testscript/reports']);

const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/** Result returned by runShellCapture without invoking a subshell. */
export interface ShellCaptureResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Type guard verifying that an unknown value is a non-null, non-array plain record. */
export function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Clamps a numeric value to the inclusive [min, max] range. */
export function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val) || val < min) {
    return min;
  }
  if (val > max) {
    return max;
  }
  return val;
}

/** Rounds a number to two decimal places. */
export function round2(val: number): number {
  return Math.round(val * 100) / 100;
}

/** Reads a UTF-8 file safely, returning empty string when missing or unreadable. */
export function readFileSafe(filePath: string): string {
  try {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  } catch (err: unknown) {
    void err;
    return '';
  }
}

/** Reads up to maxChars from filePath, returning `[MISSING]` when absent. */
export function readExcerpt(filePath: string, maxChars: number): string {
  if (!fs.existsSync(filePath)) {
    return '[MISSING]';
  }
  const raw = readFileSafe(filePath);
  return raw.length > maxChars ? `${raw.slice(0, maxChars)}\n...[truncated]` : raw;
}

function shouldSkipDir(rootDir: string, fullPath: string, name: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) {
    return true;
  }
  const relPath = path.relative(rootDir, fullPath).split(path.sep).join('/');
  return SKIP_REL_PATHS.has(relPath);
}

function hasMatchingExt(fileName: string, exts: readonly string[]): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return exts.includes(ext);
}

function walkSourceDir(
  rootDir: string,
  currentDir: string,
  exts: readonly string[],
  out: string[],
): void {
  if (!fs.existsSync(currentDir)) {
    return;
  }
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(rootDir, fullPath, entry.name)) {
        walkSourceDir(rootDir, fullPath, exts, out);
      }
    } else if (entry.isFile() && hasMatchingExt(entry.name, exts)) {
      out.push(fullPath);
    }
  }
}

/** Recursively lists source files under rootDir, skipping ignored directories. */
export function listSourceFiles(
  rootDir: string,
  exts: readonly string[] = DEFAULT_EXTS,
): string[] {
  const results: string[] = [];
  walkSourceDir(rootDir, rootDir, exts, results);
  results.sort();
  return results;
}

/** Dynamically imports a local module by absolute path, returning null on failure. */
export async function safeDynamicImport(
  absPath: string,
): Promise<Record<string, unknown> | null> {
  if (!fs.existsSync(absPath)) {
    return null;
  }
  try {
    const modUrl = pathToFileURL(absPath).href;
    const loaded: unknown = await import(modUrl);
    return isPlainRecord(loaded) ? loaded : null;
  } catch (err: unknown) {
    void err;
    return null;
  }
}

function extractExitCode(err: unknown): number {
  if (err === null || err === undefined) {
    return 0;
  }
  if (isPlainRecord(err) && typeof err['code'] === 'number') {
    return err['code'];
  }
  return -1;
}

/** Runs a command without a shell and captures exit code, stdout, and stderr. */
export function runShellCapture(
  cmd: string,
  args: readonly string[],
  cwd: string,
): Promise<ShellCaptureResult> {
  return new Promise<ShellCaptureResult>((resolve) => {
    execFile(
      cmd,
      [...args],
      {
        cwd,
        timeout: DEFAULT_SHELL_TIMEOUT_MS,
        maxBuffer: DEFAULT_MAX_BUFFER_BYTES,
      },
      (err, stdout, stderr) => {
        resolve({
          code: extractExitCode(err),
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** Constructs a normalized DeductionItem with rounded points. */
export function makeDeduction(
  criterion: CriterionKey,
  points: number,
  evidence: string,
  fix: string,
): DeductionItem {
  return {
    criterion,
    points: round2(points),
    evidence,
    fix,
  };
}

/** Extracts text from completed, fault-free SDK Interactions responses. */
export function extractInteractionText(interaction: unknown): string {
  if (!isPlainRecord(interaction) || interaction['status'] !== 'completed') return '';
  const errors = interaction['errors'];
  if (Array.isArray(errors) && errors.length > 0) return '';
  const modelOutput = findFinalModelOutput(interaction['steps']);
  const direct = interaction['output_text'];
  if (modelOutput === null) return '';
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  return extractModelContent(modelOutput?.['content']);
}

function findFinalModelOutput(
  steps: unknown,
): Record<string, unknown> | null | undefined {
  if (!Array.isArray(steps)) return undefined;
  let output: Record<string, unknown> | undefined;
  for (const step of steps) {
    if (!isPlainRecord(step)) continue;
    if (step['type'] === 'function_call') return null;
    if (step['type'] !== 'model_output') continue;
    if (step['error'] !== undefined) return null;
    output = step;
  }
  return output;
}

function extractModelContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content.flatMap((part: unknown) =>
    isPlainRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string'
      ? [part['text']] : [],
  ).join('').trim();
}

function isRequestListener(val: unknown): val is http.RequestListener {
  return typeof val === 'function';
}

/** Resolves an Express RequestListener from an imported server/app.ts module without casts. */
export function resolveExpressApp(
  mod: Record<string, unknown> | null,
): http.RequestListener | null {
  if (mod === null) {
    return null;
  }
  const createApp = mod['createApp'];
  if (typeof createApp === 'function') {
    const created: unknown = createApp();
    if (isRequestListener(created)) {
      return created;
    }
  }
  const directApp = mod['app'] ?? mod['default'];
  return isRequestListener(directApp) ? directApp : null;
}

/** Starts an ephemeral loopback HTTP server bound to an OS-assigned port. */
export function startEphemeralServer(
  listener: http.RequestListener,
): Promise<{ readonly server: http.Server; readonly port: number; readonly baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(listener);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const rawAddr = server.address();
      if (!isPlainRecord(rawAddr) || typeof rawAddr['port'] !== 'number') {
        reject(new Error('Failed to bind ephemeral port.'));
        return;
      }
      const port = rawAddr['port'];
      resolve({ server, port, baseUrl: `http://127.0.0.1:${String(port)}` });
    });
  });
}

/** Closes an ephemeral HTTP server cleanly, forcing keep-alive sockets closed first. */
export async function closeServerSafely(server: http.Server | null): Promise<void> {
  if (server === null) {
    return;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

/** Returns true only when this module was executed directly as the CLI entrypoint. */
export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (typeof entry !== 'string' || entry.length === 0) {
    return false;
  }
  try {
    return pathToFileURL(path.resolve(entry)).href === metaUrl;
  } catch (err: unknown) {
    void err;
    return false;
  }
}
