import type { AppointmentDetail, AvailabilityResponse, Problem } from '@scheduler/contracts';
import { paths } from '@scheduler/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUrl } from '../config.js';
import { checkWindow, computeSlots, evaluateSameDay, sameDayQuotaCap } from './engine.js';
import type { DayContext, ServiceSpec } from './engine.js';

const brake: ServiceSpec = {
  code: 'BRAKE_PAD_REPLACEMENT',
  durationMin: 120,
  requiredSkill: 'BRAKES',
  allowedBayTypes: ['GENERAL_LIFT', 'ALIGNMENT_RACK'],
};
const oil: ServiceSpec = {
  code: 'OIL_CHANGE',
  durationMin: 45,
  requiredSkill: 'GENERAL',
  allowedBayTypes: ['GENERAL_LIFT', 'ALIGNMENT_RACK'],
};

const emptyDay = (): DayContext => ({
  opensAt: 480,
  closesAt: 1020,
  isWorkingDay: true,
  bays: [
    { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT', busy: [] },
    { id: 'BAY-02', name: 'Bay 2', bayType: 'GENERAL_LIFT', busy: [] },
    { id: 'BAY-03', name: 'Bay 3', bayType: 'ALIGNMENT_RACK', busy: [] },
  ],
  technicians: [
    { id: 'TEC-01', name: 'An', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'], busy: [] },
    { id: 'TEC-02', name: 'Marco', skills: ['GENERAL', 'ALIGNMENT'], busy: [] },
    { id: 'TEC-03', name: 'Riya', skills: ['GENERAL', 'BRAKES'], busy: [] },
  ],
  sameDay: null,
});

describe('mock engine (SPEC §5.5 subset)', () => {
  it('T1 brake on an empty day: 15 slots 08:00…15:00', () => {
    const slots = computeSlots(emptyDay(), brake);
    expect(slots).toHaveLength(15);
    expect(slots.at(-1)!.start).toBe(15 * 60);
    expect(slots.every((s) => s.status === 'AVAILABLE')).toBe(true);
  });
  it('T4 back-to-back is allowed and overlap rejects', () => {
    const day = emptyDay();
    day.technicians[0]!.busy = [{ start: 480, end: 600 }];
    day.technicians[2]!.busy = [{ start: 480, end: 600 }];
    const slots = computeSlots(day, brake);
    expect(slots[0]!.status).toBe('NO_QUALIFIED_TECHNICIAN');
    expect(slots.find((s) => s.start === 600)!.status).toBe('AVAILABLE');
  });
  it('T9 assignment prefers the technician with fewer skills', () => {
    const slot = checkWindow(emptyDay(), brake, 480);
    expect(slot.proposed?.technician.id).toBe('TEC-03');
    expect(slot.proposed?.bay.id).toBe('BAY-01');
  });
  it('T15 same-day lead rounds up to the grid', () => {
    const r = evaluateSameDay({
      isExpress: true,
      partsAvailable: true,
      nowMin: 550,
      leadMin: 120,
      opensAt: 480,
      closesAt: 1020,
      durationMin: 45,
      stepMin: 30,
      bayCount: 5,
      quotaPct: 20,
    });
    expect(r).toEqual({ blocked: null, earliestStart: 690, quotaCap: 1 });
  });
  it('T16 same-day quota', () => {
    const day = emptyDay();
    day.sameDay = { earliestStart: 480, quotaCap: 1, sameDayBusy: [{ start: 780, end: 825 }] };
    const by = (t: number) => checkWindow(day, oil, t).status;
    expect([by(750), by(780), by(810)]).toEqual([
      'SAME_DAY_QUOTA_REACHED',
      'SAME_DAY_QUOTA_REACHED',
      'SAME_DAY_QUOTA_REACHED',
    ]);
    expect([by(720), by(840)]).toEqual(['AVAILABLE', 'AVAILABLE']);
  });
  it('T17–T21 policy precedence and quota cap', () => {
    const base = {
      isExpress: true,
      partsAvailable: true,
      nowMin: 550,
      leadMin: 120,
      opensAt: 480,
      closesAt: 1020,
      durationMin: 45,
      stepMin: 30,
      bayCount: 5,
      quotaPct: 20,
    };
    expect(evaluateSameDay({ ...base, isExpress: false }).blocked).toBe('SERVICE_NOT_EXPRESS');
    expect(evaluateSameDay({ ...base, partsAvailable: false }).blocked).toBe('PARTS_UNAVAILABLE');
    expect(evaluateSameDay({ ...base, nowMin: 15 * 60 + 20 }).blocked).toBe('PAST_CUTOFF');
    expect(evaluateSameDay({ ...base, isExpress: false, partsAvailable: false }).blocked).toBe(
      'SERVICE_NOT_EXPRESS',
    );
    expect([
      sameDayQuotaCap(5, 20),
      sameDayQuotaCap(10, 15),
      sameDayQuotaCap(20, 20),
      sameDayQuotaCap(5, 0),
    ]).toEqual([1, 1, 4, 0]);
  });
});

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(apiUrl(path), init);
  return { status: res.status, body: (await res.json()) as T };
}

describe('mock API handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T02:10:00Z'));
    return () => vi.useRealTimers();
  });

  const availability = (date: string, service = 'OIL_CHANGE', vehicle = 'VEH-01', dealer = 'DLR-01') =>
    api<AvailabilityResponse>(
      `${paths.availability(dealer)}?serviceType=${service}&date=${date}&vehicleId=${vehicle}`,
    );

  it('applies powertrain applicability (422) and the booking horizon (422)', async () => {
    const ev = await availability('2026-10-09', 'OIL_CHANGE', 'VEH-02');
    expect(ev.status).toBe(422);
    expect((ev.body as unknown as Problem).code).toBe('SERVICE_NOT_APPLICABLE');
    const far = await availability('2026-12-25');
    expect((far.body as unknown as Problem).code).toBe('OUTSIDE_BOOKING_HORIZON');
  });

  it('today is non-null sameDay info with earliest start 11:30; weekends have no slots', async () => {
    const today = await availability('2026-10-08');
    expect(today.body.sameDay).toMatchObject({
      isSameDay: true,
      blocked: null,
      earliestStartTime: '11:30',
      quotaCap: 1,
      lateGraceMin: 15,
    });
    expect(today.body.slots.every((s) => s.isExpress && s.startTime >= '11:30')).toBe(true);
    const sat = await availability('2026-10-10');
    expect(sat.body).toMatchObject({ isWorkingDay: false, slots: [] });
  });

  it('POST creates a retrievable appointment and makes the window busy', async () => {
    const before = await availability('2026-10-09', 'BRAKE_PAD_REPLACEMENT');
    const first = before.body.slots.find((s) => s.status === 'AVAILABLE');
    expect(first).toBeDefined();
    const body = {
      customerId: 'CUS-10482',
      vehicleId: 'VEH-01',
      dealershipId: 'DLR-01',
      serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
      date: '2026-10-09',
      startTime: first!.startTime,
      bookingSessionId: crypto.randomUUID(),
    };
    const created = await api<AppointmentDetail>(paths.appointments, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(created.status).toBe(201);
    expect(created.body.reference).toMatch(/^APT-20261009-\d{4}$/);
    expect(created.body.serviceBay.id).toBe(first!.proposed!.serviceBay.id);

    const fetched = await api<AppointmentDetail>(paths.appointment(created.body.reference));
    expect(fetched.status).toBe(200);
    const again = await api<Problem>(paths.appointments, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, bookingSessionId: crypto.randomUUID() }),
    });
    expect(again.status).toBe(409);
    expect(['VEHICLE_ALREADY_BOOKED', 'SLOT_UNAVAILABLE']).toContain(again.body.code);
  });
});
