import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkWindow, computeSlots } from '../../../src/domain/availability/index.js';
import type { DayContext, Interval, ServiceSpec } from '../../../src/domain/availability/index.js';
import { ALL_SERVICES, makeDlr01Day } from './fixtures.js';

const RESOURCE_IDS = ['BAY-01', 'BAY-02', 'BAY-03', 'BAY-04', 'BAY-05', 'TEC-01', 'TEC-02', 'TEC-03', 'TEC-04'];

const intervalArb = fc
  .tuple(fc.integer({ min: 16, max: 33 }), fc.integer({ min: 1, max: 8 }))
  .map(([s, len]): Interval => ({ start: s * 30, end: Math.min(s * 30 + len * 30, 17 * 60) }));

const dayArb = fc
  .record({
    busy: fc.dictionary(fc.constantFrom(...RESOURCE_IDS), fc.array(intervalArb, { maxLength: 4 })),
    sameDay: fc.option(
      fc.record({
        earliest: fc.integer({ min: 0, max: 12 }),
        quotaCap: fc.integer({ min: 0, max: 3 }),
        sameDayBusy: fc.array(intervalArb, { maxLength: 4 }),
      }),
      { nil: undefined },
    ),
  })
  .map(({ busy, sameDay }): DayContext => {
    const day = makeDlr01Day();
    for (const r of [...day.bays, ...day.technicians]) r.busy = busy[r.id] ?? [];
    day.sameDay = sameDay
      ? { earliestStart: 480 + sameDay.earliest * 30, quotaCap: sameDay.quotaCap, sameDayBusy: sameDay.sameDayBusy }
      : null;
    return day;
  });

const serviceArb = fc.constantFrom(...ALL_SERVICES);

// Independent oracle: minute-by-minute occupancy instead of interval-overlap arithmetic.
const freeMinutes = (busy: Interval[], start: number, end: number): boolean => {
  const occupied = new Set<number>();
  for (const b of busy) for (let m = b.start; m < b.end; m++) occupied.add(m);
  for (let m = start; m < end; m++) if (occupied.has(m)) return false;
  return true;
};

const oracle = (day: DayContext, svc: ServiceSpec, start: number) => {
  const end = start + svc.durationMin;
  const bays = day.bays.filter((b) => svc.allowedBayTypes.includes(b.bayType) && freeMinutes(b.busy, start, end));
  const techs = day.technicians.filter((t) => t.skills.includes(svc.requiredSkill) && freeMinutes(t.busy, start, end));
  return { bays, techs, end };
};

describe('availability properties', () => {
  it('(a) every AVAILABLE slot proposes an allowed, free bay and a skilled, free technician', () => {
    fc.assert(
      fc.property(dayArb, serviceArb, (day, svc) => {
        for (const slot of computeSlots(day, svc)) {
          if (slot.status !== 'AVAILABLE') {
            expect(slot.proposed).toBeNull();
            continue;
          }
          const bay = day.bays.find((b) => b.id === slot.proposed!.bayId)!;
          const tech = day.technicians.find((t) => t.id === slot.proposed!.technicianId)!;
          expect(svc.allowedBayTypes).toContain(bay.bayType);
          expect(tech.skills).toContain(svc.requiredSkill);
          expect(freeMinutes(bay.busy, slot.start, slot.end)).toBe(true);
          expect(freeMinutes(tech.busy, slot.start, slot.end)).toBe(true);
          expect(slot.end - slot.start).toBe(svc.durationMin);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('(b) every status is justified by independently re-derived eligibility', () => {
    fc.assert(
      fc.property(dayArb, serviceArb, (day, svc) => {
        const slots = computeSlots(day, svc);
        for (const slot of slots) {
          const { bays, techs } = oracle(day, svc, slot.start);
          if (bays.length === 0 && techs.length === 0) expect(slot.status).toBe('FULLY_BOOKED');
          else if (bays.length === 0) expect(slot.status).toBe('NO_BAY');
          else if (techs.length === 0) expect(slot.status).toBe('NO_QUALIFIED_TECHNICIAN');
          else {
            const used = day.sameDay
              ? day.sameDay.sameDayBusy.filter((b) => freeMinutes([b], slot.start, slot.end) === false).length
              : 0;
            const quotaHit = day.sameDay !== null && used >= day.sameDay.quotaCap;
            expect(slot.status).toBe(quotaHit ? 'SAME_DAY_QUOTA_REACHED' : 'AVAILABLE');
          }
        }
        // grid coverage: exactly the candidates >= earliestStart that fit before close
        const expected: number[] = [];
        for (let t = day.opensAt; t + svc.durationMin <= day.closesAt; t += 30) {
          if (!day.sameDay || t >= day.sameDay.earliestStart) expected.push(t);
        }
        expect(slots.map((s) => s.start)).toEqual(expected);
      }),
      { numRuns: 300 },
    );
  });

  it('(c) checkWindow agrees with computeSlots for every grid start', () => {
    fc.assert(
      fc.property(dayArb, serviceArb, (day, svc) => {
        for (const slot of computeSlots(day, svc)) {
          expect(checkWindow(day, svc, slot.start)).toEqual(slot);
        }
      }),
      { numRuns: 300 },
    );
  });
});
