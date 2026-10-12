import type {
  AlternativeSlot,
  AppointmentDetail,
  AppointmentSummary,
  ErrorCode,
  Problem,
  SlotStatus,
} from '@scheduler/contracts';
import { dealerships } from '@scheduler/contracts/fixtures';
import { HttpResponse } from 'msw';
import { addDays, dayOrdinal, fmtMin, isoWeekday, parseMin, toOffsetIso, zonedToMs } from '../lib/time.js';
import type { DayContext, Interval, ServiceSpec } from './engine.js';
import { findAlternatives } from './engine.js';
import { hasScenario } from './scenario.js';
import {
  PARTS,
  getCustomer,
  getDealership,
  getServiceType,
  getVehicle,
  partRequirements,
  store,
} from './store.js';
import type { MockAppointment } from './store.js';

// ---------- problem+json ----------

const TITLES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_ERROR: 'Validation error',
  NOT_FOUND: 'Not found',
  SLOT_UNAVAILABLE: 'Slot unavailable',
  VEHICLE_ALREADY_BOOKED: 'Vehicle already booked',
  PARTS_UNAVAILABLE: 'Parts unavailable',
  OUTSIDE_BOOKING_HORIZON: 'Outside booking horizon',
  OUTSIDE_OPENING_HOURS: 'Outside opening hours',
  MISALIGNED_START: 'Misaligned start time',
  VEHICLE_NOT_OWNED: 'Vehicle not owned',
  SERVICE_NOT_APPLICABLE: 'Service not applicable',
  SERVICE_NOT_EXPRESS: 'Service is not express',
  LEAD_TIME_NOT_MET: 'Lead time not met',
  APPOINTMENT_NOT_CANCELLABLE: 'Appointment not cancellable',
  APPOINTMENT_NOT_ACTIVE: 'Appointment not active',
  APPOINTMENT_NOT_RESCHEDULABLE: 'Appointment not reschedulable',
  LATE_ARRIVAL: 'Late arrival',
  STOCK_BELOW_RESERVED: 'Stock below reserved',
};

export function problem(status: number, code: ErrorCode, detail: string, extra: Partial<Problem> = {}) {
  const body: Problem = {
    type: `https://scheduler.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[code] ?? 'Error',
    status,
    code,
    detail,
    ...extra,
  };
  return HttpResponse.json(body, { status, headers: { 'Content-Type': 'application/problem+json' } });
}

export const notFound = (what: string) => problem(404, 'NOT_FOUND', `${what} was not found.`);

// ---------- day context ----------

/** Deterministic pseudo-busy intervals (minutes after opening), ported from the design's `busyFor`. */
function busyFor(resource: number, seed: number, dayMinutes: number): Interval[] {
  let x = (seed * 97 + resource * 31 + 11) % 233;
  const out: Interval[] = [];
  let t = 0;
  for (let i = 0; i < 10; i++) {
    x = (x * 73 + 41) % 233;
    const gap = 30 * (1 + (x % 6));
    x = (x * 73 + 41) % 233;
    const len = 30 * (1 + (x % 3));
    const start = t + gap;
    if (start >= dayMinutes) break;
    const end = Math.min(dayMinutes, start + len);
    out.push({ start, end });
    t = end;
  }
  return out;
}

export interface ServiceLike {
  code: string;
  durationMin: number;
  requiredSkill: ServiceSpec['requiredSkill'];
  allowedBayTypes: ServiceSpec['allowedBayTypes'];
}
export const specOf = (s: ServiceLike): ServiceSpec => ({
  code: s.code,
  durationMin: s.durationMin,
  requiredSkill: s.requiredSkill,
  allowedBayTypes: s.allowedBayTypes,
});

const shift = (iv: Interval[], by: number): Interval[] =>
  iv.map((i) => ({ start: i.start + by, end: i.end + by }));

/** Day context for a dealership: deterministic background load plus appointments created through the mock API. */
export function buildDay(dealershipId: string, date: string, excludeReference?: string): DayContext {
  const d = getDealership(dealershipId)!;
  const dealerIdx = dealerships.findIndex((x) => x.id === dealershipId);
  const opensAt = parseMin(d.opensAt);
  const closesAt = parseMin(d.closesAt);
  const isWorkingDay = d.workingDays.includes(isoWeekday(date));
  const seed = dealerIdx * 5 + (dayOrdinal(date) % 40);
  const mine = store.appointments.filter(
    (a) =>
      a.status === 'CONFIRMED' &&
      a.dealershipId === dealershipId &&
      a.date === date &&
      a.reference !== excludeReference,
  );

  const bays = store.bays[dealershipId]!.map((b, i) => ({
    ...b,
    busy: [
      ...shift(busyFor(i, seed, closesAt - opensAt), opensAt),
      ...mine.filter((a) => a.bayId === b.id).map((a) => ({ start: a.startMin, end: a.endMin })),
    ],
  }));
  const technicians = store.techs[dealershipId]!.map((t, i) => ({
    ...t,
    busy: [
      ...shift(busyFor(10 + i, seed, closesAt - opensAt), opensAt),
      ...mine.filter((a) => a.technicianId === t.id).map((a) => ({ start: a.startMin, end: a.endMin })),
    ],
  }));
  return { opensAt, closesAt, isWorkingDay, bays, technicians, sameDay: null };
}

export function withSameDay(
  day: DayContext,
  dealershipId: string,
  date: string,
  earliestStart: number,
  quotaCap: number,
  excludeReference?: string,
): DayContext {
  const sameDayBusy = store.appointments
    .filter(
      (a) =>
        a.status === 'CONFIRMED' &&
        a.channel === 'SAME_DAY' &&
        a.dealershipId === dealershipId &&
        a.date === date &&
        a.reference !== excludeReference,
    )
    .map((a) => ({ start: a.startMin, end: a.endMin }));
  return { ...day, sameDay: { earliestStart, quotaCap, sameDayBusy } };
}

// ---------- parts ----------

export function partsAvailable(
  dealershipId: string,
  serviceCode: string,
  modelName: string,
  excludeReference?: string,
): boolean {
  const own = store.appointments.find((a) => a.reference === excludeReference);
  // The appointment being rescheduled already holds same-day parts: they count as free (SPEC §6.5).
  if (own?.parts.some((p) => !p.released)) return true;
  if (hasScenario('parts')) return false;
  const stock = store.inventory[dealershipId] ?? {};
  return partRequirements(serviceCode, modelName).every((r) => {
    const line = stock[r.sku];
    return !!line && line.onHand - line.reserved >= r.qty;
  });
}

// ---------- alternatives ----------

export function alternativesFor(
  dealershipId: string,
  service: ServiceLike,
  date: string,
  startMin: number,
  today: string,
  horizonEnd: string,
  sameDayFor: (day: DayContext, date: string) => DayContext,
  excludeReference?: string,
): AlternativeSlot[] {
  const d = getDealership(dealershipId)!;
  const days: { date: string; day: DayContext }[] = [];
  let cursor = date;
  while (cursor <= horizonEnd && days.length < 8) {
    const base = buildDay(dealershipId, cursor, excludeReference);
    if (base.isWorkingDay)
      days.push({ date: cursor, day: cursor === today ? sameDayFor(base, cursor) : base });
    cursor = addDays(cursor, 1);
  }
  const tz = d.timezone;
  return findAlternatives(days, specOf(service), { date, start: startMin }, 5).map(({ date: dt, slot }) => ({
    date: dt,
    startTime: fmtMin(slot.start),
    endTime: fmtMin(slot.end),
    startAt: toOffsetIso(zonedToMs(dt, slot.start, tz), tz),
  }));
}

export function slotConflictDetail(
  status: SlotStatus,
  skillLabel: string,
  start: number,
  end: number,
): string {
  const window = `${fmtMin(start)}–${fmtMin(end)}`;
  switch (status) {
    case 'NO_QUALIFIED_TECHNICIAN':
      return `No ${skillLabel}-qualified technician is free for the full window ${window}.`;
    case 'NO_BAY':
      return `No suitable service bay is free for the full window ${window}.`;
    case 'SAME_DAY_QUOTA_REACHED':
      return `Same-day capacity is full for the window ${window}.`;
    default:
      return `No service bay and qualified technician are both free for the full window ${window}.`;
  }
}

export const SKILL_WORD: Record<string, string> = {
  GENERAL: 'General',
  BRAKES: 'Brakes',
  ALIGNMENT: 'Alignment',
  EV_HIGH_VOLTAGE: 'EV high-voltage',
};

// ---------- DTOs ----------

export function toDetail(a: MockAppointment): AppointmentDetail {
  const d = getDealership(a.dealershipId)!;
  const tz = d.timezone;
  const s = getServiceType(a.serviceTypeCode)!;
  const v = getVehicle(a.vehicleId)!;
  const bay = store.bays[a.dealershipId]!.find((b) => b.id === a.bayId)!;
  const tech = store.techs[a.dealershipId]!.find((t) => t.id === a.technicianId)!;
  const iso = (min: number) => toOffsetIso(zonedToMs(a.date, min, tz), tz);
  return {
    reference: a.reference,
    status: a.status,
    channel: a.channel,
    startAt: iso(a.startMin),
    endAt: iso(a.endMin),
    localDate: a.date,
    startTime: fmtMin(a.startMin),
    endTime: fmtMin(a.endMin),
    durationMin: a.endMin - a.startMin,
    createdAt: toOffsetIso(a.createdAtMs, tz),
    checkedInAt: a.checkedInAtMs === null ? null : toOffsetIso(a.checkedInAtMs, tz),
    cancelledAt: a.cancelledAtMs === null ? null : toOffsetIso(a.cancelledAtMs, tz),
    lateGraceMin: d.sameDayPolicy.lateGraceMin,
    customer: getCustomer(a.customerId)!,
    vehicle: v,
    dealership: { id: d.id, name: d.name, timezone: tz },
    serviceType: { code: s.code, name: s.name, requiredSkill: s.requiredSkill, isExpress: s.isExpress },
    technician: tech,
    serviceBay: bay,
    parts: a.parts.map((p) => ({ sku: p.sku, name: partName(p.sku), qty: p.qty })),
    history: a.history,
  };
}

const partName = (sku: string) => PARTS.find((p) => p.sku === sku)?.name ?? sku;

export function toSummary(a: MockAppointment): AppointmentSummary {
  const detail = toDetail(a);
  return {
    reference: detail.reference,
    status: detail.status,
    channel: detail.channel,
    startAt: detail.startAt,
    endAt: detail.endAt,
    localDate: detail.localDate,
    startTime: detail.startTime,
    endTime: detail.endTime,
    durationMin: detail.durationMin,
    dealership: { id: detail.dealership.id, name: detail.dealership.name },
    serviceType: { code: detail.serviceType.code, name: detail.serviceType.name },
    vehicle: {
      id: detail.vehicle.id,
      modelYear: detail.vehicle.modelYear,
      modelName: detail.vehicle.modelName,
      plate: detail.vehicle.plate,
    },
  };
}
