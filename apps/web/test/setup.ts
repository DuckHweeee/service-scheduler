import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../src/mocks/server.js';
import { resetStore } from '../src/mocks/store.js';

// findBy*/waitFor default to 1 s; give them headroom under load (see vite.config.ts testTimeout note).
configure({ asyncUtilTimeout: 5_000 });

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetStore();
  window.history.replaceState({}, '', '/');
});
afterAll(() => server.close());
