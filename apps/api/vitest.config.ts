import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ['test/helpers/global-setup.ts'],
    coverage: { provider: 'v8', include: ['src/**'] },
  },
});
