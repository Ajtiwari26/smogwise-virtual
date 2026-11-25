import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clamp,
  listSourceFiles,
  makeDeduction,
  round2,
  safeDynamicImport,
} from './utils.js';

describe('evaluator utils', () => {
  it('clamps values within inclusive bounds', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(4.5, 0, 10)).toBe(4.5);
  });

  it('rounds numbers to two decimal places', () => {
    expect(round2(3.14159)).toBe(3.14);
    expect(round2(2.346)).toBe(2.35);
  });

  it('builds a normalized deduction item', () => {
    const item = makeDeduction('security', -1.236, 'evidence', 'fix');
    expect(item).toEqual({
      criterion: 'security',
      points: -1.24,
      evidence: 'evidence',
      fix: 'fix',
    });
  });

  it('lists source files and returns null for missing imports', async () => {
    const dir = path.resolve(process.cwd(), 'testscript', 'evaluator');
    const files = listSourceFiles(dir, ['.ts']);
    expect(files.some((file) => file.endsWith('utils.ts'))).toBe(true);

    const missing = await safeDynamicImport(path.join(dir, 'missing.ts'));
    expect(missing).toBeNull();
  });
});
