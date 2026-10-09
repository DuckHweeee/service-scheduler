// Opus-owned glue shared by A3 (availability endpoint) and A4 (booking). Resolves everything needed to evaluate one
// dealership-day for one service + vehicle: entity lookups, applicability, booking horizon, same-day policy (SPEC §5.4)
// and the engine's DayContext. Booking-specific checks (grid alignment, opening hours, lead time) stay in booking.ts.
import type { AlternativeSlot, AvailabilitySlot, SameDayInfo } from '@scheduler/contracts';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import {
  getDealership,
  getServiceType,
  getVehicle,
  listBays,
  loadDayContext,
  partsAvailability,
  type DealershipRow,
  type PartsAvailability,
  type ServiceTypeRow,
  type VehicleRow,
} from '../db/repositories/index.js';
import { appointments } from '../db/schema.js';
import {
  DEFAULT_ALTERNATIVES_LIMIT,
  DEFAULT_STEP_MIN,
  evaluateSameDay,
  findAlternatives,
  type DatedDay,
  type DatedSlot,
  type DayContext,
  type SameDayDecision,
  type ServiceSpec,
  type SlotResult,
} from '../domain/availability/index.js';
import { DomainError, notFound } from '../domain/errors.js';
import {
  addLocalDays,
  formatLocalTime,
  isWorkingDay,
  localMinutesCeilOf,
  localToday,
  nextWorkingDays,
  parseLocalTime,
  toInstant,
  toOffsetIso,
} from '../domain/time.js';

/** SPEC A7: today … today + 30 days. */
export const BOOKING_HORIZON_DAYS = 30;

export interface DayPlanInput {
  dealershipId: string;
  serviceTypeCode: string;
  vehicleId: string;
  /** Dealership-local `YYYY-MM-DD`. */
  date: string;
}

export interface DayPlan {
  input: DayPlanInput;
  dealership: DealershipRow;
  service: ServiceTypeRow;
  vehicle: VehicleRow;
  spec: ServiceSpec;
  /** Dealership-local today, from the injected clock. */
  today: string;
  isWorkingDay: boolean;
  /** True iff `date === today` and the dealership works today. */
  isSameDay: boolean;
  /** Same-day policy outcome; null unless `isSameDay`. */
  sameDay: SameDayDecision | null;
  /** Parts check for the vehicle; null unless `isSameDay` (A12: advance bookings don't check parts). */
  parts: PartsAvailability | null;
  /** Engine input. `day.sameDay` is set iff `isSameDay` and the policy did not block the day. */
  day: DayContext;
}

export const toServiceSpec = (s: ServiceTypeRow): ServiceSpec => ({
  code: s.code,
  durationMin: s.durationMin,
  requiredSkill: s.requiredSkill,
  allowedBayTypes: s.allowedBayTypes,
});

/**
 * Throws DomainError: 404 NOT_FOUND (dealership / service type / vehicle), 422 SERVICE_NOT_APPLICABLE (powertrain),
 * 422 OUTSIDE_BOOKING_HORIZON (before today or after today + 30). A non-working day is NOT an error here
 * (`isWorkingDay: false`); booking turns it into DEALERSHIP_CLOSED.
 */
export async function resolveDayPlan(db: DbOrTx, clock: Clock, input: DayPlanInput): Promise<DayPlan> {
  // Sequential on purpose: `db` may be a transaction (one connection); pg rejects overlapping queries on one client.
  const dealership = await getDealership(db, input.dealershipId);
  const service = await getServiceType(db, input.serviceTypeCode);
  const vehicle = await getVehicle(db, input.vehicleId);
  if (!dealership) throw notFound('Dealership', input.dealershipId);
  if (!service) throw notFound('Service type', input.serviceTypeCode);
  if (!vehicle) throw notFound('Vehicle', input.vehicleId);

  if (!service.powertrains.includes(vehicle.powertrain)) {
    throw new DomainError(
      'SERVICE_NOT_APPLICABLE',
      422,
      `${service.name} is not available for ${vehicle.powertrain === 'EV' ? 'electric' : 'combustion'} vehicles`,
    );
  }

  const tz = dealership.timezone;
  const today = localToday(clock, tz);
  const lastBookable = addLocalDays(today, BOOKING_HORIZON_DAYS);
  if (input.date < today || input.date > lastBookable) {
    throw new DomainError(
      'OUTSIDE_BOOKING_HORIZON',
      422,
      `Bookings are accepted from ${today} to ${lastBookable} (dealership local time)`,
    );
  }

  const working = isWorkingDay(input.date, dealership.workingDays);
  const isSameDay = working && input.date === today;
  const spec = toServiceSpec(service);

  let sameDay: SameDayDecision | null = null;
  let parts: PartsAvailability | null = null;
  if (isSameDay) {
    const p = await partsAvailability(db, dealership.id, service.code, vehicle.modelName);
    const bays = await listBays(db, dealership.id);
    parts = p;
    sameDay = evaluateSameDay({
      isSameDay: true,
      isExpress: service.isExpress,
      partsAvailable: p.available,
      nowMin: localMinutesCeilOf(clock.now(), tz), // seconds round up: the lead time is a minimum
      leadMin: dealership.sameDayLeadMin,
      opensAt: parseLocalTime(dealership.opensAt),
      closesAt: parseLocalTime(dealership.closesAt),
      durationMin: service.durationMin,
      stepMin: DEFAULT_STEP_MIN,
      bayCount: bays.length,
      quotaPct: dealership.sameDayQuotaPct,
    });
  }

  const day = await loadDayContext(db, dealership, input.date, {
    sameDay:
      sameDay && !sameDay.blocked
        ? { earliestStart: sameDay.earliestStart, quotaCap: sameDay.quotaCap }
        : null,
  });

  return {
    input,
    dealership,
    service,
    vehicle,
    spec,
    today,
    isWorkingDay: working,
    isSameDay,
    sameDay,
    parts,
    day,
  };
}

/**
 * Up to `limit` AVAILABLE slots strictly after `afterStartMin` on the plan's date, then on following working days
 * within the horizon. Each day is re-resolved from the database (call this OUTSIDE the booking transaction, after
 * rollback), so same-day rules apply to today and blocked days are skipped.
 */
export async function loadAlternatives(
  db: DbOrTx,
  clock: Clock,
  plan: DayPlan,
  afterStartMin: number,
  limit = DEFAULT_ALTERNATIVES_LIMIT,
): Promise<AlternativeSlot[]> {
  const lastBookable = addLocalDays(plan.today, BOOKING_HORIZON_DAYS);
  const dates = [
    plan.input.date,
    ...nextWorkingDays(plan.input.date, limit, plan.dealership.workingDays),
  ].filter((d) => d <= lastBookable);
  const days: DatedDay[] = [];
  for (const date of dates) {
    const p = date === plan.input.date ? plan : await resolveDayPlan(db, clock, { ...plan.input, date });
    if (p.sameDay?.blocked || !p.isWorkingDay) continue;
    days.push({ date, day: date === plan.input.date ? await reloadDay(db, p) : p.day });
  }
  if (days.length === 0) return [];

  // The vehicle's own confirmed bookings (at any dealership) rule a slot out too: offering one would only lead to
  // 409 VEHICLE_ALREADY_BOOKED. Ask the engine for enough extra candidates to cover every start such a booking can block.
  const tz = plan.dealership.timezone;
  const busy = await loadVehicleBusy(
    db,
    plan.vehicle.id,
    toInstant(days[0]!.date, 0, tz),
    toInstant(addLocalDays(days[days.length - 1]!.date, 1), 0, tz),
  );
  const blockedStarts = busy.reduce(
    (n, b) => n + Math.ceil(((b.endAt.getTime() - b.startAt.getTime()) / 60_000 + plan.spec.durationMin) / DEFAULT_STEP_MIN),
    0,
  );
  const overlapsVehicle = ({ date, slot }: DatedSlot): boolean => {
    const start = toInstant(date, slot.start, tz).getTime();
    const end = toInstant(date, slot.end, tz).getTime();
    return busy.some((b) => b.startAt.getTime() < end && start < b.endAt.getTime());
  };
  return findAlternatives(days, plan.spec, { date: plan.input.date, start: afterStartMin }, limit + blockedStarts)
    .filter((d) => !overlapsVehicle(d))
    .slice(0, limit)
    .map((d) => toAlternativeDto(tz, d));
}

const loadVehicleBusy = (db: DbOrTx, vehicleId: string, from: Date, to: Date) =>
  db
    .select({ startAt: appointments.startAt, endAt: appointments.endAt })
    .from(appointments)
    .where(
      and(
        eq(appointments.vehicleId, vehicleId),
        eq(appointments.status, 'CONFIRMED'),
        lt(appointments.startAt, to),
        gt(appointments.endAt, from),
      ),
    );

const reloadDay = (db: DbOrTx, plan: DayPlan): Promise<DayContext> =>
  loadDayContext(db, plan.dealership, plan.input.date, {
    sameDay: plan.day.sameDay
      ? { earliestStart: plan.day.sameDay.earliestStart, quotaCap: plan.day.sameDay.quotaCap }
      : null,
  });

// ---------- DTO mappers ----------

export const localIso = (date: string, minutes: number, tz: string): string =>
  toOffsetIso(toInstant(date, minutes, tz), tz);

export const toSlotDto = (plan: DayPlan, slot: SlotResult): AvailabilitySlot => {
  const tz = plan.dealership.timezone;
  let proposed: AvailabilitySlot['proposed'] = null;
  if (slot.proposed) {
    const bay = plan.day.bays.find((b) => b.id === slot.proposed!.bayId)!;
    const tech = plan.day.technicians.find((t) => t.id === slot.proposed!.technicianId)!;
    proposed = {
      serviceBay: { id: bay.id, name: bay.name, bayType: bay.bayType },
      technician: { id: tech.id, name: tech.name },
    };
  }
  return {
    startTime: formatLocalTime(slot.start),
    endTime: formatLocalTime(slot.end),
    startAt: localIso(plan.input.date, slot.start, tz),
    status: slot.status,
    isExpress: plan.isSameDay,
    proposed,
  };
};

export const toAlternativeDto = (tz: string, { date, slot }: DatedSlot): AlternativeSlot => ({
  date,
  startTime: formatLocalTime(slot.start),
  endTime: formatLocalTime(slot.end),
  startAt: localIso(date, slot.start, tz),
});

export const toSameDayInfo = (plan: DayPlan): SameDayInfo | null =>
  plan.isSameDay && plan.sameDay
    ? {
        isSameDay: true,
        blocked: plan.sameDay.blocked,
        earliestStartTime:
          plan.sameDay.earliestStart < parseLocalTime(plan.dealership.closesAt)
            ? formatLocalTime(plan.sameDay.earliestStart)
            : null,
        leadTimeMin: plan.dealership.sameDayLeadMin,
        quotaCap: plan.sameDay.quotaCap,
        lateGraceMin: plan.dealership.lateGraceMin,
      }
    : null;
