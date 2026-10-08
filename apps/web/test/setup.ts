import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../src/mocks/server.js';
import { resetStore } from '../src/mocks/store.js';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetStore();
  window.history.replaceState({}, '', '/');
});
afterAll(() => server.close());
