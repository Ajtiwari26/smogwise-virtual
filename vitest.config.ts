import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 10000,
    environment: 'node',
    include: ['testscript/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'api/**/*.ts'],
      exclude: [
        'testscript/**',
        'dist/**',
        'dev.ts',
        '*.config.*',
        'src/main.tsx',
        'src/domain/types.ts',
        'server/index.ts',
      ],
      thresholds: {
        statements: 92,
        branches: 85,
        functions: 92,
        lines: 92,
      },
    },
  },
});
