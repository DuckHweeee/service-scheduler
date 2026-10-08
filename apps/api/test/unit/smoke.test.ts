import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';

describe('wave 0 smoke', () => {
  it('fixed clock is stable', () => {
    expect(fixedClock('2026-10-08T09:10:00+07:00').now().toISOString()).toBe('2026-10-08T02:10:00.000Z');
  });
});
