import { describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import {
  addLocalDays,
  formatLocalTime,
  isoWeekday,
  isWorkingDay,
  localDateOf,
  localMinutesCeilOf,
  localMinutesOf,
  localToday,
  nextWorkingDays,
  parseLocalTime,
  toInstant,
  toOffsetIso,
} from '../../src/domain/time.js';

const HCM = 'Asia/Ho_Chi_Minh';
const LON = 'Europe/London';
const WEEK = [1, 2, 3, 4, 5];

describe('local time parsing', () => {
  it('parses and formats', () => {
    expect(parseLocalTime('13:00')).toBe(780);
    expect(parseLocalTime('08:00:00')).toBe(480);
    expect(formatLocalTime(780)).toBe('13:00');
    expect(formatLocalTime(0)).toBe('00:00');
    expect(() => parseLocalTime('25:00')).toThrow();
    expect(() => parseLocalTime('abc')).toThrow();
  });
});

describe('instants (no DST)', () => {
  it('converts local → instant → offset ISO', () => {
    const at = toInstant('2026-10-08', 780, HCM);
    expect(at.toISOString()).toBe('2026-10-08T06:00:00.000Z');
    expect(toOffsetIso(at, HCM)).toBe('2026-10-08T13:00:00+07:00');
    expect(localDateOf(at, HCM)).toBe('2026-10-08');
    expect(localMinutesOf(at, HCM)).toBe(780);
  });

  it('local date rolls over across the UTC boundary', () => {
    const at = new Date('2026-10-08T18:30:00Z'); // 01:30 next day in HCM
    expect(localDateOf(at, HCM)).toBe('2026-10-09');
    expect(localMinutesOf(at, HCM)).toBe(90);
  });

  it('localMinutesCeilOf counts a started minute as a full one', () => {
    expect(localMinutesCeilOf(new Date('2026-10-08T09:30:00+07:00'), HCM)).toBe(570);
    expect(localMinutesCeilOf(new Date('2026-10-08T09:30:30+07:00'), HCM)).toBe(571);
    expect(localMinutesCeilOf(new Date('2026-10-08T09:30:00.001+07:00'), HCM)).toBe(571);
  });

  it('localToday uses the clock', () => {
    expect(localToday(fixedClock('2026-10-08T20:00:00Z'), HCM)).toBe('2026-10-09');
  });
});

describe('DST (Europe/London)', () => {
  it('spring forward 2026-03-29 (GMT → BST)', () => {
    expect(toOffsetIso(toInstant('2026-03-28', 600, LON), LON)).toBe('2026-03-28T10:00:00+00:00');
    expect(toOffsetIso(toInstant('2026-03-29', 600, LON), LON)).toBe('2026-03-29T10:00:00+01:00');
    expect(toInstant('2026-03-29', 600, LON).toISOString()).toBe('2026-03-29T09:00:00.000Z');
    // 24h of elapsed time apart is NOT one local day across the change
    const a = toInstant('2026-03-28', 600, LON);
    const b = toInstant('2026-03-29', 600, LON);
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(23);
  });

  it('fall back 2026-10-25 (BST → GMT)', () => {
    expect(toInstant('2026-10-25', 600, LON).toISOString()).toBe('2026-10-25T10:00:00.000Z');
    expect(toInstant('2026-10-24', 600, LON).toISOString()).toBe('2026-10-24T09:00:00.000Z');
    const a = toInstant('2026-10-24', 600, LON);
    const b = toInstant('2026-10-25', 600, LON);
    expect((b.getTime() - a.getTime()) / 3_600_000).toBe(25);
  });

  it('round-trips local minutes and date around the change', () => {
    const at = new Date('2026-03-29T00:30:00Z'); // 00:30 GMT, last pre-change hour
    expect(localDateOf(at, LON)).toBe('2026-03-29');
    expect(localMinutesOf(at, LON)).toBe(30);
    const after = new Date('2026-03-29T01:00:00Z'); // 02:00 BST
    expect(localMinutesOf(after, LON)).toBe(120);
  });
});

describe('calendar helpers', () => {
  it('addLocalDays handles month/year ends and DST-free math', () => {
    expect(addLocalDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addLocalDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('isoWeekday / isWorkingDay', () => {
    expect(isoWeekday('2026-10-08')).toBe(4); // Thursday
    expect(isoWeekday('2026-10-11')).toBe(7); // Sunday
    expect(isWorkingDay('2026-10-09', WEEK)).toBe(true);
    expect(isWorkingDay('2026-10-10', WEEK)).toBe(false);
  });

  it('nextWorkingDays skips weekends and excludes the start date', () => {
    expect(nextWorkingDays('2026-10-08', 3, WEEK)).toEqual(['2026-10-09', '2026-10-12', '2026-10-13']);
    expect(nextWorkingDays('2026-10-10', 1, WEEK)).toEqual(['2026-10-12']);
    expect(nextWorkingDays('2026-10-10', 0, WEEK)).toEqual([]);
    expect(nextWorkingDays('2026-10-10', 2, [])).toEqual([]);
  });
});
