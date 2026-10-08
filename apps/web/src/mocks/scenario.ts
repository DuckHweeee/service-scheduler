import { fmtMin, zonedNow, zonedToMs } from '../lib/time.js';

/**
 * Mock scenarios are switched with the page URL query `?mock=a,b`:
 * - `conflict` — the next POST /appointments answers 409 SLOT_UNAVAILABLE with 5 alternatives, then behaves normally
 * - `parts`    — parts are out of stock for today (PARTS_UNAVAILABLE)
 * - `cutoff`   — mock "now" is 15:20 so same-day booking has closed (PAST_CUTOFF)
 * - `morning`  — mock "now" is 09:10 local today so same-day slots exist whatever the real time is
 */
export type Scenario = 'conflict' | 'parts' | 'cutoff' | 'morning';

export function activeScenarios(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  const raw = new URLSearchParams(window.location.search).getAll('mock');
  return new Set(
    raw
      .flatMap((v) => v.split(','))
      .map((v) => v.trim())
      .filter(Boolean),
  );
}

export const hasScenario = (s: Scenario): boolean => activeScenarios().has(s);

/** The mock "now" (ms) for a dealership timezone. */
export function mockNowMs(tz: string): number {
  const real = Date.now();
  const target = hasScenario('cutoff') ? 15 * 60 + 20 : hasScenario('morning') ? 9 * 60 + 10 : null;
  if (target === null) return real;
  return zonedToMs(zonedNow(real, tz).date, target, tz);
}

export function mockNow(tz: string): { ms: number; date: string; minutes: number } {
  const ms = mockNowMs(tz);
  return { ms, ...zonedNow(ms, tz) };
}

export const describeNow = (tz: string): string => {
  const n = mockNow(tz);
  return `${n.date} ${fmtMin(n.minutes)}`;
};
