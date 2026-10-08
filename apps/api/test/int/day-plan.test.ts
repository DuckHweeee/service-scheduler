import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fixedClock } from '../../src/clock.js';
import { computeSlots } from '../../src/domain/availability/index.js';
import { DomainError } from '../../src/domain/errors.js';
import { loadAlternatives, resolveDayPlan, toSameDayInfo, toSlotDto } from '../../src/services/day-plan.js';
import { createTestDb, seedReference, type TestDb } from '../helpers/index.js';

// 2026-10-08 is a Thursday; 09:10 local (UTC+7).
const morning = fixedClock('2026-10-08T09:10:00+07:00');
const base = { dealershipId: 'DLR-01', serviceTypeCode: 'OIL_CHANGE', vehicleId: 'VEH-01' };

let t: TestDb;
beforeAll(async () => {
  t = await createTestDb();
  await seedReference(t.db);
});
afterAll(() => t.cleanup());

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof DomainError ? e.code : String(e);
  }
};

describe('resolveDayPlan', () => {
  it('same-day express: lead time, quota and parts are evaluated', async () => {
    const plan = await resolveDayPlan(t.db, morning, { ...base, date: '2026-10-08' });
    expect(plan.isSameDay).toBe(true);
    expect(plan.sameDay).toMatchObject({ blocked: null, earliestStart: 11 * 60 + 30, quotaCap: 1 });
    expect(plan.day.sameDay?.earliestStart).toBe(690);
    expect(plan.parts?.available).toBe(true);
    const slots = computeSlots(plan.day, plan.spec);
    expect(toSlotDto(plan, slots[0]!)).toMatchObject({
      startTime: '11:30',
      startAt: '2026-10-08T11:30:00+07:00',
      isExpress: true,
      status: 'AVAILABLE',
    });
    expect(toSameDayInfo(plan)).toMatchObject({ earliestStartTime: '11:30', quotaCap: 1, lateGraceMin: 15 });
  });

  it('same-day blocks: not express, parts, past cutoff', async () => {
    const brake = await resolveDayPlan(t.db, morning, { ...base, serviceTypeCode: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-08' });
    expect(brake.sameDay?.blocked).toBe('SERVICE_NOT_EXPRESS');
    expect(brake.day.sameDay).toBeNull();

    const parts = await resolveDayPlan(t.db, morning, { ...base, dealershipId: 'DLR-02', date: '2026-10-08' });
    expect(parts.sameDay?.blocked).toBe('PARTS_UNAVAILABLE');

    const late = await resolveDayPlan(t.db, fixedClock('2026-10-08T15:20:00+07:00'), { ...base, date: '2026-10-08' });
    expect(late.sameDay?.blocked).toBe('PAST_CUTOFF');
    expect(toSameDayInfo(late)?.earliestStartTime).toBeNull();
  });

  it('future day: no same-day policy, no parts check', async () => {
    const plan = await resolveDayPlan(t.db, morning, { ...base, date: '2026-10-09' });
    expect(plan.isSameDay).toBe(false);
    expect(plan.sameDay).toBeNull();
    expect(plan.parts).toBeNull();
    expect(toSameDayInfo(plan)).toBeNull();
  });

  it('weekend is not an error', async () => {
    const plan = await resolveDayPlan(t.db, morning, { ...base, date: '2026-10-10' });
    expect(plan.isWorkingDay).toBe(false);
    expect(computeSlots(plan.day, plan.spec)).toEqual([]);
  });

  it('validation errors', async () => {
    expect(await codeOf(resolveDayPlan(t.db, morning, { ...base, dealershipId: 'DLR-99', date: '2026-10-09' }))).toBe('NOT_FOUND');
    expect(await codeOf(resolveDayPlan(t.db, morning, { ...base, vehicleId: 'VEH-02', date: '2026-10-09' }))).toBe(
      'SERVICE_NOT_APPLICABLE',
    );
    expect(await codeOf(resolveDayPlan(t.db, morning, { ...base, date: '2026-10-07' }))).toBe('OUTSIDE_BOOKING_HORIZON');
    expect(await codeOf(resolveDayPlan(t.db, morning, { ...base, date: '2026-11-07' }))).toBe('ok');
    expect(await codeOf(resolveDayPlan(t.db, morning, { ...base, date: '2026-11-08' }))).toBe('OUTSIDE_BOOKING_HORIZON');
  });
});

describe('loadAlternatives', () => {
  it('returns the next five available slots after the requested start, rolling over days', async () => {
    const plan = await resolveDayPlan(t.db, morning, { ...base, serviceTypeCode: 'BRAKE_PAD_REPLACEMENT', date: '2026-10-09' });
    const sameDayAlts = await loadAlternatives(t.db, morning, plan, 10 * 60);
    expect(sameDayAlts.map((a) => a.startTime)).toEqual(['10:30', '11:00', '11:30', '12:00', '12:30']);

    const nearClose = await loadAlternatives(t.db, morning, plan, 14 * 60 + 30);
    expect(nearClose.map((a) => `${a.date} ${a.startTime}`)).toEqual([
      '2026-10-09 15:00',
      '2026-10-12 08:00',
      '2026-10-12 08:30',
      '2026-10-12 09:00',
      '2026-10-12 09:30',
    ]);
  });
});
