import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: {
    environment: 'jsdom',
    // Generous limits: these jsdom + MSW suites timed out at the 5 s default when the machine was saturated by parallel
    // agent test runs (load average > 200). They are not slow tests; they must not be flaky on a busy CI runner.
    testTimeout: 20_000,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    css: { modules: { classNameStrategy: 'non-scoped' } },
  },
});
