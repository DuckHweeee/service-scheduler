// Used by Stryker only: unit tests, no embedded Postgres global setup.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/unit/**/*.test.ts'], environment: 'node', testTimeout: 30_000 },
});
