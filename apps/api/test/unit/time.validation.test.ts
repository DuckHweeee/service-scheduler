// W5-Q1: negative-path / boundary tests added after mutation testing (Stryker) of src/domain/time.ts, errors.ts, intervals.ts.
import { describe, expect, it } from 'vitest';
import { DomainError, notFound } from '../../src/domain/errors.js';
import { busyMinutes } from '../../src/domain/availability/intervals.js';
import {
  addLocalDays,
  formatLocalTime,
  isoWeekday,
  localDateOf,
  parseLocalTime,
  toInstant,
  toOffsetIso,
} from '../../src/domain/time.js';

describe('parseLocalTime validation', () => {
  it('accepts boundaries 00:00, 23:59 and 24:00', () => {
    expect(parseLocalTime('00:00')).toBe(0);
    expect(parseLocalTime('23:59')).toBe(1439);
    expect(parseLocalTime('24:00')).toBe(1440);
    expect(parseLocalTime('9:05')).toBe(545);
    expect(parseLocalTime('09:05:00')).toBe(545);
  });
  it('adds hours and minutes (not subtracts)', () => {
    expect(parseLocalTime('01:30')).toBe(90);
  });
  it.each(['24:01', '25:00', '12:60', '12:99', '', 'abc', 'x09:00', '09:00x', '09:00:00:00', '9'])(
    'rejects %j',
    (v) => {
      expect(() => parseLocalTime(v)).toThrow(`Invalid local time: ${v}`);
    },
  );
});

describe('formatLocalTime validation', () => {
  it('accepts 0 and 1440', () => {
    expect(formatLocalTime(0)).toBe('00:00');
    expect(formatLocalTime(1440)).toBe('24:00');
  });
  it.each([-1, 1441, 1.5, Number.NaN])('rejects %s', (v) => {
    expect(() => formatLocalTime(v)).toThrow(`Invalid minutes: ${v}`);
  });
});

describe('date and instant validation', () => {
  it.each(['2026-1-01', '2026-01-1', 'x2026-01-01', '2026-01-01x', ''])(
    'addLocalDays rejects malformed date %j',
    (v) => {
      expect(() => addLocalDays(v, 1)).toThrow(`Invalid local date: ${v}`);
    },
  );
  it('rejects a well-formed but impossible date', () => {
    expect(() => isoWeekday('2026-02-30')).toThrow('Invalid local date: 2026-02-30');
    expect(() => toInstant('2026-1-01', 0, 'UTC')).toThrow('Invalid local date: 2026-1-01');
  });
  it('rejects a nonexistent local datetime (hour 25)', () => {
    expect(() => toInstant('2026-01-01', 25 * 60, 'UTC')).toThrow('Invalid local datetime: 2026-01-01 1500 UTC');
  });
  it('rejects an invalid instant or timezone', () => {
    expect(() => toOffsetIso(new Date(Number.NaN), 'UTC')).toThrow('Invalid instant/timezone');
    expect(() => localDateOf(new Date(0), 'Not/AZone')).toThrow('Invalid instant/timezone');
  });
});

describe('errors', () => {
  it('DomainError carries name, code, status and extras', () => {
    const e = new DomainError('NOT_FOUND', 404, 'x');
    expect(e.name).toBe('DomainError');
    expect(e.extras).toEqual({});
    expect(e).toBeInstanceOf(Error);
  });
  it('notFound builds a 404 NOT_FOUND', () => {
    const e = notFound('Vehicle', 'V-1');
    expect(e).toBeInstanceOf(DomainError);
    expect(e.code).toBe('NOT_FOUND');
    expect(e.status).toBe(404);
    expect(e.message).toBe('Vehicle V-1 not found');
  });
});

describe('busyMinutes', () => {
  it('sums interval lengths', () => {
    expect(
      busyMinutes([
        { start: 60, end: 120 },
        { start: 200, end: 230 },
      ]),
    ).toBe(90);
    expect(busyMinutes([])).toBe(0);
  });
});
