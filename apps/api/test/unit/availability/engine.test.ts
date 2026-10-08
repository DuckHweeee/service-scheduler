import { describe, expect, it } from 'vitest';
import {
  checkWindow,
  computeSlots,
  evaluateSameDay,
  findAlternatives,
  sameDayQuotaCap,
} from '../../../src/domain/availability/index.js';
import type { DatedDay, SameDayPolicyInput } from '../../../src/domain/availability/index.js';
import { ALL_DAY, hm, makeDlr01Day, SERVICES } from './fixtures.js';

const starts = (slots: { start: number }[]) => slots.map((s) => s.start);
const statusAt = (slots: { start: number; status: string }[], t: string) =>
  slots.find((s) => s.start === hm(t))?.status;

describe('computeSlots', () => {
  it('T1 brake 120m on an empty day gives 15 AVAILABLE slots 08:00..15:00', () => {
    const slots = computeSlots(makeDlr01Day(), SERVICES.BRAKE_PAD_REPLACEMENT);
    expect(slots).toHaveLength(15);
    expect(slots[0]!.start).toBe(hm('08:00'));
    expect(slots.at(-1)!.start).toBe(hm('15:00'));
    expect(slots.every((s) => s.status === 'AVAILABLE' && s.proposed !== null)).toBe(true);
    expect(slots[0]!.end).toBe(hm('10:00'));
  });

  it('T2 oil 45m on an empty day gives 17 slots, last starts 16:00', () => {
    const slots = computeSlots(makeDlr01Day(), SERVICES.OIL_CHANGE);
    expect(slots).toHaveLength(17);
    expect(slots.at(-1)!.start).toBe(hm('16:00'));
  });

  it('T3 weekend returns no slots', () => {
    expect(computeSlots(makeDlr01Day({ isWorkingDay: false }), SERVICES.OIL_CHANGE)).toEqual([]);
  });

  it('T4 back-to-back busy ends are free; overlapping starts are rejected', () => {
    const day = makeDlr01Day({ busy: { 'TEC-01': ['08:00-10:00'], 'TEC-03': ['08:00-10:00'] } });
    const slots = computeSlots(day, SERVICES.BRAKE_PAD_REPLACEMENT);
    for (const t of ['08:00', '08:30', '09:00', '09:30']) {
      expect(statusAt(slots, t)).toBe('NO_QUALIFIED_TECHNICIAN');
    }
    expect(statusAt(slots, '10:00')).toBe('AVAILABLE');
  });

  it('T5 partial overlap rejects the window', () => {
    const day = makeDlr01Day({ busy: { 'TEC-01': ['10:30-11:00'], 'TEC-03': ['09:00-11:00'] } });
    expect(statusAt(computeSlots(day, SERVICES.BRAKE_PAD_REPLACEMENT), '10:00')).toBe(
      'NO_QUALIFIED_TECHNICIAN',
    );
  });

  it('T6 alignment with BAY-03 busy all day is NO_BAY', () => {
    const day = makeDlr01Day({ busy: { 'BAY-03': [ALL_DAY] } });
    const slots = computeSlots(day, SERVICES.WHEEL_ALIGNMENT);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.status === 'NO_BAY' && s.proposed === null)).toBe(true);
  });

  it('T7 alignment with BAY-03 and TEC-02 busy all day is FULLY_BOOKED', () => {
    const day = makeDlr01Day({ busy: { 'BAY-03': [ALL_DAY], 'TEC-02': [ALL_DAY] } });
    const slots = computeSlots(day, SERVICES.WHEEL_ALIGNMENT);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.status === 'FULLY_BOOKED')).toBe(true);
  });

  // SPEC CONTRADICTION (reported): the T8 row says "08:00…10:30 NO_QUALIFIED_TECHNICIAN", but by rules §5.2.3/§5.2.5
  // a 90-minute window starting 11:00 (11:00-12:30) and 11:30 (11:30-13:00) also overlaps the 08:00-12:00 busy block,
  // so those are NO_QUALIFIED_TECHNICIAN as well. We implement the rules: 08:00..11:30 blocked, 12:00 available.
  it('T8 EV check with both EV technicians busy 08:00-12:00 (rules: blocked through 11:30, not 10:30)', () => {
    const day = makeDlr01Day({ busy: { 'TEC-01': ['08:00-12:00'], 'TEC-04': ['08:00-12:00'] } });
    const slots = computeSlots(day, SERVICES.EV_BATTERY_CHECK);
    for (let t = hm('08:00'); t <= hm('11:30'); t += 30) {
      expect(slots.find((s) => s.start === t)!.status).toBe('NO_QUALIFIED_TECHNICIAN');
    }
    expect(statusAt(slots, '12:00')).toBe('AVAILABLE');
  });
});

describe('assignment', () => {
  it('T9 brake picks TEC-03 (fewer skills than TEC-01) and BAY-01', () => {
    const slot = computeSlots(makeDlr01Day(), SERVICES.BRAKE_PAD_REPLACEMENT)[0]!;
    expect(slot.proposed).toEqual({ bayId: 'BAY-01', technicianId: 'TEC-03' });
  });

  it('T10a oil picks BAY-01 and TEC-02 (skill/busy tie broken by id)', () => {
    const slot = computeSlots(makeDlr01Day(), SERVICES.OIL_CHANGE)[0]!;
    expect(slot.proposed).toEqual({ bayId: 'BAY-01', technicianId: 'TEC-02' });
  });

  it('T10b a technician with busy minutes that day loses the tie', () => {
    const day = makeDlr01Day({ busy: { 'TEC-02': ['16:00-17:00'] } });
    expect(computeSlots(day, SERVICES.OIL_CHANGE)[0]!.proposed).toEqual({
      bayId: 'BAY-01',
      technicianId: 'TEC-03',
    });
  });

  it('T11 oil falls back to the ALIGNMENT_RACK when both lifts are busy', () => {
    const day = makeDlr01Day({ busy: { 'BAY-01': [ALL_DAY], 'BAY-02': [ALL_DAY] } });
    expect(computeSlots(day, SERVICES.OIL_CHANGE)[0]!.proposed!.bayId).toBe('BAY-03');
  });

  it('prefers BAY-02 over BAY-03 when BAY-01 is busy (type preference then id)', () => {
    const day = makeDlr01Day({ busy: { 'BAY-01': [ALL_DAY] } });
    expect(computeSlots(day, SERVICES.OIL_CHANGE)[0]!.proposed!.bayId).toBe('BAY-02');
  });
});

describe('findAlternatives', () => {
  const day2: DatedDay = { date: '2026-10-09', day: makeDlr01Day() };

  it('T12 returns 5 slots starting 11:00 on the same day', () => {
    // Everything busy until 11:00 except the requested 10:00 slot being "after" itself.
    const day = makeDlr01Day({
      busy: { 'TEC-01': ['10:30-11:00'], 'TEC-02': ['10:30-11:00'], 'TEC-03': ['10:30-11:00'], 'TEC-04': ['10:30-11:00'] },
    });
    const out = findAlternatives([{ date: '2026-10-08', day }, day2], SERVICES.OIL_CHANGE, {
      date: '2026-10-08',
      start: hm('10:00'),
    });
    // 10:30 and 10:00-window overlap are blocked, 11:00 is first free start after 10:00 (10:30 blocked).
    expect(out).toHaveLength(5);
    expect(out.every((o) => o.date === '2026-10-08')).toBe(true);
    expect(starts(out.map((o) => o.slot))).toEqual([11, 11.5, 12, 12.5, 13].map((h) => h * 60));
  });

  it('T13 rolls over to the next day when the first day has too few slots left', () => {
    const out = findAlternatives(
      [{ date: '2026-10-08', day: makeDlr01Day() }, day2],
      SERVICES.OIL_CHANGE,
      { date: '2026-10-08', start: hm('15:30') },
    );
    expect(out.map((o) => [o.date, o.slot.start])).toEqual([
      ['2026-10-08', hm('16:00')],
      ['2026-10-09', hm('08:00')],
      ['2026-10-09', hm('08:30')],
      ['2026-10-09', hm('09:00')],
      ['2026-10-09', hm('09:30')],
    ]);
  });

  it('respects a custom limit, skips earlier dates, non-working days and unavailable slots', () => {
    const closed: DatedDay = { date: '2026-10-10', day: makeDlr01Day({ isWorkingDay: false }) };
    const early: DatedDay = { date: '2026-10-07', day: makeDlr01Day() };
    const busy: DatedDay = {
      date: '2026-10-11',
      day: makeDlr01Day({ busy: { 'BAY-05': [ALL_DAY], 'TEC-01': [ALL_DAY], 'TEC-02': [ALL_DAY], 'TEC-03': [ALL_DAY], 'TEC-04': [ALL_DAY] } }),
    };
    const out = findAlternatives([early, closed, busy, day2], SERVICES.OIL_CHANGE, { date: '2026-10-08', start: 0 }, 2);
    expect(out.map((o) => o.date)).toEqual(['2026-10-09', '2026-10-09']);
    expect(findAlternatives([day2], SERVICES.OIL_CHANGE, { date: '2026-10-09', start: 0 }, 0)).toEqual([]);
  });
});

describe('checkWindow', () => {
  it('T14 brake ending exactly at close is included, 30 minutes later is excluded', () => {
    const day = makeDlr01Day();
    const slots = computeSlots(day, SERVICES.BRAKE_PAD_REPLACEMENT);
    expect(statusAt(slots, '15:00')).toBe('AVAILABLE');
    expect(statusAt(slots, '15:30')).toBeUndefined();
    expect(checkWindow(day, SERVICES.BRAKE_PAD_REPLACEMENT, hm('15:00')).status).toBe('AVAILABLE');
    expect(checkWindow(day, SERVICES.BRAKE_PAD_REPLACEMENT, hm('15:30'))).toMatchObject({
      status: 'FULLY_BOOKED',
      proposed: null,
    });
  });

  it('returns FULLY_BOOKED for starts before opening and on non-working days', () => {
    expect(checkWindow(makeDlr01Day(), SERVICES.OIL_CHANGE, hm('07:30'))).toMatchObject({
      status: 'FULLY_BOOKED',
      proposed: null,
    });
    expect(checkWindow(makeDlr01Day({ isWorkingDay: false }), SERVICES.OIL_CHANGE, hm('09:00')).status).toBe(
      'FULLY_BOOKED',
    );
  });

  it('evaluates off-grid starts in hours for the window', () => {
    const day = makeDlr01Day();
    expect(checkWindow(day, SERVICES.OIL_CHANGE, hm('09:10'))).toMatchObject({
      start: hm('09:10'),
      end: hm('09:55'),
      status: 'AVAILABLE',
    });
  });
});

describe('same-day slots', () => {
  it('T15 now 09:10 + lead 120 gives earliestStart 11:30 and the first slot is 11:30', () => {
    const decision = evaluateSameDay({ ...base(), nowMin: hm('09:10') });
    expect(decision.earliestStart).toBe(hm('11:30'));
    const day = makeDlr01Day({
      sameDay: { earliestStart: '11:30', quotaCap: decision.quotaCap },
    });
    expect(computeSlots(day, SERVICES.OIL_CHANGE)[0]!.start).toBe(hm('11:30'));
  });

  it('T16 quota cap 1 with a same-day job 13:00-13:45 blocks overlapping oil windows', () => {
    const day = makeDlr01Day({
      sameDay: { earliestStart: '08:00', quotaCap: 1, sameDayBusy: ['13:00-13:45'] },
    });
    const slots = computeSlots(day, SERVICES.OIL_CHANGE);
    for (const t of ['12:30', '13:00', '13:30']) expect(statusAt(slots, t)).toBe('SAME_DAY_QUOTA_REACHED');
    expect(statusAt(slots, '12:00')).toBe('AVAILABLE');
    expect(statusAt(slots, '14:00')).toBe('AVAILABLE');
    expect(slots.find((s) => s.start === hm('13:00'))!.proposed).toBeNull();
  });

  it('quotaCap 0 makes every slot SAME_DAY_QUOTA_REACHED; resource shortage wins over quota', () => {
    const day = makeDlr01Day({ sameDay: { earliestStart: '08:00', quotaCap: 0 } });
    expect(computeSlots(day, SERVICES.OIL_CHANGE).every((s) => s.status === 'SAME_DAY_QUOTA_REACHED')).toBe(true);
    const busy = makeDlr01Day({ busy: { 'BAY-03': [ALL_DAY] }, sameDay: { earliestStart: '08:00', quotaCap: 0 } });
    expect(computeSlots(busy, SERVICES.WHEEL_ALIGNMENT)[0]!.status).toBe('NO_BAY');
  });
});

function base(): SameDayPolicyInput {
  return {
    isSameDay: true,
    isExpress: true,
    partsAvailable: true,
    nowMin: hm('09:00'),
    leadMin: 120,
    opensAt: hm('08:00'),
    closesAt: hm('17:00'),
    durationMin: 45,
    stepMin: 30,
    bayCount: 5,
    quotaPct: 20,
  };
}

describe('evaluateSameDay', () => {
  it('not same-day is never blocked', () => {
    expect(evaluateSameDay({ ...base(), isSameDay: false, isExpress: false })).toEqual({
      blocked: null,
      earliestStart: hm('08:00'),
      quotaCap: Infinity,
    });
  });

  it('T17 brake today is SERVICE_NOT_EXPRESS', () => {
    expect(evaluateSameDay({ ...base(), isExpress: false, durationMin: 120 }).blocked).toBe('SERVICE_NOT_EXPRESS');
  });

  it('T18 oil today with parts missing is PARTS_UNAVAILABLE', () => {
    expect(evaluateSameDay({ ...base(), partsAvailable: false }).blocked).toBe('PARTS_UNAVAILABLE');
  });

  it('T19 oil today at 15:20 with lead 120 is PAST_CUTOFF', () => {
    expect(evaluateSameDay({ ...base(), nowMin: hm('15:20') }).blocked).toBe('PAST_CUTOFF');
  });

  it('T20 non-express and parts missing reports SERVICE_NOT_EXPRESS first', () => {
    expect(evaluateSameDay({ ...base(), isExpress: false, partsAvailable: false }).blocked).toBe(
      'SERVICE_NOT_EXPRESS',
    );
  });

  it('T21 quota cap table', () => {
    expect(sameDayQuotaCap(5, 20)).toBe(1);
    expect(sameDayQuotaCap(10, 15)).toBe(1);
    expect(sameDayQuotaCap(20, 20)).toBe(4);
    expect(sameDayQuotaCap(5, 0)).toBe(0);
  });

  it('earliestStart: exact grid hit is kept, early morning clamps to opensAt, ends exactly at close is allowed', () => {
    expect(evaluateSameDay({ ...base(), nowMin: hm('09:30') }).earliestStart).toBe(hm('11:30'));
    expect(evaluateSameDay({ ...base(), nowMin: hm('03:00'), leadMin: 0 })).toMatchObject({
      earliestStart: hm('08:00'),
      blocked: null,
      quotaCap: 1,
    });
    // earliest 16:00 + 60 = 17:00 == close -> allowed
    expect(evaluateSameDay({ ...base(), nowMin: hm('14:00'), durationMin: 60 }).blocked).toBeNull();
  });
});
