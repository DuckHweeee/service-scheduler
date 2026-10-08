import type { Interval } from './types.js';

/** Half-open overlap: a.start < end && start < a.end. */
export const overlaps = (busy: Interval, start: number, end: number): boolean =>
  busy.start < end && start < busy.end;

export const isFree = (busy: Interval[], start: number, end: number): boolean =>
  !busy.some((b) => overlaps(b, start, end));

export const busyMinutes = (busy: Interval[]): number =>
  busy.reduce((sum, b) => sum + (b.end - b.start), 0);
