import { test as base, expect } from '@playwright/test';
import { CLOCK_OVERRIDE } from './constants.js';

/**
 * `baseURL` comes from the stack started by global setup (free port, known only at runtime).
 * The browser clock is pinned to the API's `CLOCK_OVERRIDE` so web and API agree on which day is "today"
 * (the API exposes no server time; see apps/web/README note in the W3-F3 report).
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  baseURL: async ({}, use) => {
    await use(process.env.E2E_WEB_URL);
  },
  context: async ({ context }, use) => {
    await context.clock.setFixedTime(new Date(CLOCK_OVERRIDE));
    await use(context);
  },
});

export { expect };

export const apiUrl = (path: string): string => `${process.env.E2E_API_URL}${path}`;
