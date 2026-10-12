import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ['test/helpers/global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        // Measured: lines/statements 94.16, branches 91.15, functions 92.25 -> floor(measured) - 2.
        lines: 92,
        statements: 92,
        branches: 89,
        functions: 90,
        // The availability engine was promised at 100% (PLAN W1-A2).
        'src/domain/availability/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
