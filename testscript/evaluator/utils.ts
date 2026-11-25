/**
 * Shared helper utilities for the SmogWise Virtual hybrid evaluator.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CriterionKey, DeductionItem } from './types.js';

const DEFAULT_EXTS: readonly string[] = ['.ts', '.tsx', '.js', '.jsx'];

const SKIP_DIR_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.etta',
  '.git',
]);

const SKIP_REL_PATHS: ReadonlySet<string> = new Set(['testscript/reports']);

const DEFAULT_SHELL_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;

export interface ShellCaptureResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Clamps a numeric value to the inclusive [min, max] range.
 */
export function clamp(val: number, min: number, max: number): number {
  if (val < min) {
    return min;
  }
  if (val > max) {
    return max;
  }
  return val;
}

/**
 * Rounds a number to two decimal places.
 */
export function round2(val: number): number {
  return Math.round(val * 100) / 100;
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

/**
 * Recursively lists source files under rootDir, skipping ignored directories.
 */
export function listSourceFiles(
  rootDir: string,
  exts: readonly string[] = DEFAULT_EXTS,
): string[] {
  const results: string[] = [];
  walkSourceDir(rootDir, rootDir, exts, results);
  results.sort();
  return results;
}

/**
 * Dynamically imports a local module by absolute path, returning null on failure.
 */
export async function safeDynamicImport<T>(absPath: string): Promise<T | null> {
  if (!fs.existsSync(absPath)) {
    return null;
  }
  try {
    const modUrl = pathToFileURL(absPath).href;
    const loaded: unknown = await import(modUrl);
    return loaded as T;
  } catch {
    return null;
  }
}

type ExitError = { readonly code?: string | number | null | undefined };

function extractExitCode(err: ExitError | null): number {
  if (err === null) {
    return 0;
  }
  return typeof err.code === 'number' ? err.code : 1;
}

/**
 * Runs a command without a shell and captures exit code, stdout, and stderr.
 */
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

/**
 * Constructs a normalized DeductionItem with rounded points.
 */
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
