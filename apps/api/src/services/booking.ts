// POST /appointments — SPEC §6.1 / ADR-002. Order of operations:
//   1. idempotency lookup, validation (no events written on validation errors), SLOT_REQUESTED
//   2. BEGIN; advisory lock on (dealership, local date)
//   3. everything is re-read INSIDE the tx under the lock: idempotency key, day plan, DayContext
//   4. vehicle overlap, 5. window check, 6. same-day parts, 7. insert + events, COMMIT
//   Failures roll back; CHECK_FAILED is written after the rollback. A 23P01 from the exclusion constraints is the
//   backstop (defence in depth) and maps to 409 as well.
import type { AlternativeSlot, AppointmentDetail, CreateAppointmentRequest, SlotStatus } from '@scheduler/contracts';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { Db, Tx } from '../db/client.js';
import { getCustomer, getVehicle } from '../db/repositories/index.js';
import { appointmentParts, appointments, bookingEvents, inventory } from '../db/schema.js';
import { checkWindow } from '../domain/availability/index.js';
import { DomainError, notFound } from '../domain/errors.js';
import { formatLocalTime, parseLocalTime, toInstant } from '../domain/time.js';
import { getTelemetry, startTimer, type BookingAttempt } from '../observability/telemetry.js';
import { pgErrorCode } from '../plugins/error-handler.js';
import { loadAppointmentDetail } from './appointment-query.js';
import { loadAlternatives, resolveDayPlan, type DayPlan } from './day-plan.js';

export type FailReason = SlotStatus | 'PARTS_UNAVAILABLE' | 'VEHICLE_ALREADY_BOOKED' | 'CONFLICT';

/** Thrown inside the transaction to roll it back; handled (CHECK_FAILED + 409) after the rollback. */
export class CheckFailure extends Error {
  constructor(readonly reason: FailReason) {
    super(reason);
  }
}

class IdempotentReplay extends Error {
  constructor(readonly appointmentId: string) {
    super('idempotent replay');
  }
}

export interface BookingResult {
  /** false when an existing appointment was returned for a repeated Idempotency-Key. */
  created: boolean;
  appointment: AppointmentDetail;
}

/** Name of the violated constraint, walking `cause` like `pgErrorCode` does (drizzle wraps driver errors). */
export const pgConstraint = (err: unknown): string | undefined => {
  let cur: unknown = err;
  for (let depth = 0; cur && typeof cur === 'object' && depth < 5; depth++) {
    const c = (cur as { constraint?: unknown }).constraint;
    if (typeof c === 'string') return c;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
};

const planInput = (b: CreateAppointmentRequest) => ({
  dealershipId: b.dealershipId,
  serviceTypeCode: b.serviceTypeCode,
  vehicleId: b.vehicleId,
  date: b.date,
});

const findByKey = async (db: Db | Tx, key: string): Promise<AppointmentDetail | null> => {
  const [row] = await db.select({ id: appointments.id }).from(appointments).where(eq(appointments.idempotencyKey, key));
  return row ? loadAppointmentDetail(db, { id: row.id }) : null;
};

/**
 * A repeated key replays the original appointment only for the same request. A different request under the same key
 * (another slot, or another customer) is a client bug: answering 200 would claim it succeeded and could disclose
 * someone else's appointment.
 */
const replay = (existing: AppointmentDetail, body: CreateAppointmentRequest): BookingResult => {
  const same =
    existing.customer.id === body.customerId &&
    existing.vehicle.id === body.vehicleId &&
    existing.dealership.id === body.dealershipId &&
    existing.serviceType.code === body.serviceTypeCode &&
    existing.localDate === body.date &&
    existing.startTime === body.startTime;
  if (!same) {
    throw new DomainError('IDEMPOTENCY_KEY_REUSED', 422, 'This Idempotency-Key was already used for a different booking request');
  }
  return { created: false, appointment: existing };
};

/**
 * SPEC §6.1 step 1 target validation, shared with reschedule (§6.5): working day, 30-minute grid, opening hours,
 * same-day express and lead time. Throws 422 DomainErrors; returns the start/end in local minutes.
 */
export function validateTarget(plan: DayPlan, date: string, startTime: string): { startMin: number; endMin: number } {
  const { dealership, spec } = plan;
  const body = { date, startTime };
  if (!plan.isWorkingDay) {
    throw new DomainError('DEALERSHIP_CLOSED', 422, `${dealership.name} is closed on ${body.date}`);
  }
  const startMin = parseLocalTime(body.startTime);
  const endMin = startMin + spec.durationMin;
  const opensAt = plan.day.opensAt;
  const closesAt = plan.day.closesAt;
  if ((startMin - opensAt) % 30 !== 0) {
    throw new DomainError('MISALIGNED_START', 422, `Start time must be on the 30-minute grid from ${formatLocalTime(opensAt)}`);
  }
  if (startMin < opensAt || endMin > closesAt) {
    throw new DomainError(
      'OUTSIDE_OPENING_HOURS',
      422,
      `The job must start and finish between ${formatLocalTime(opensAt)} and ${formatLocalTime(closesAt)}`,
    );
  }
  if (plan.isSameDay && plan.sameDay) {
    if (plan.sameDay.blocked === 'SERVICE_NOT_EXPRESS') {
      throw new DomainError('SERVICE_NOT_EXPRESS', 422, `${plan.service.name} cannot be booked for today; same-day covers express services only`);
    }
    if (plan.sameDay.blocked === 'PAST_CUTOFF' || startMin < plan.sameDay.earliestStart) {
      throw new DomainError(
        'LEAD_TIME_NOT_MET',
        422,
        plan.sameDay.blocked === 'PAST_CUTOFF'
          ? 'Same-day booking for today has closed'
          : `Same-day bookings start no earlier than ${formatLocalTime(plan.sameDay.earliestStart)}`,
      );
    }
  }
  return { startMin, endMin };
}

/** Observability wrapper: one span + one `booking_attempts_total` increment per call, no PII in attributes. */
export async function createAppointment(
  deps: { db: Db; clock: Clock },
  body: CreateAppointmentRequest,
  idempotencyKey?: string,
): Promise<BookingResult> {
  const telemetry = getTelemetry();
  const elapsed = startTimer();
  const ctx: { channel: string } = { channel: 'unknown' };
  const attrs = { 'dealership.id': body.dealershipId, 'service.code': body.serviceTypeCode };
  return telemetry.withSpan('booking.reserve', attrs, async (span) => {
    let attempt: BookingAttempt;
    try {
      const result = await reserveAppointment(deps, body, idempotencyKey, ctx);
      attempt = { outcome: result.created ? 'created' : 'replayed', reason: 'none', channel: ctx.channel };
      return result;
    } catch (err) {
      const e = err instanceof DomainError ? err : undefined;
      attempt = {
        outcome: e && e.status !== 409 ? 'invalid' : 'rejected',
        reason: e ? (e.extras.reason ?? e.code) : 'INTERNAL_ERROR',
        channel: ctx.channel,
      };
      throw err;
    } finally {
      // `attempt` is always assigned: both paths above set it before leaving the try block.
      const done = attempt!;
      span.setAttributes({ 'booking.channel': done.channel, 'booking.outcome': done.outcome, 'booking.reason': done.reason });
      telemetry.bookingAttempt({ ...done, dealershipId: body.dealershipId, serviceTypeCode: body.serviceTypeCode, durationMs: Math.round(elapsed() * 1000) });
    }
  });
}

async function reserveAppointment(
  deps: { db: Db; clock: Clock },
  body: CreateAppointmentRequest,
  idempotencyKey: string | undefined,
  ctx: { channel: string },
): Promise<BookingResult> {
  const { db, clock } = deps;

  // ---- step 1: idempotent replay, then validation (no events yet) ----
  if (idempotencyKey) {
    const existing = await findByKey(db, idempotencyKey);
    if (existing) return replay(existing, body);
  }

  const [customer, vehicle] = await Promise.all([getCustomer(db, body.customerId), getVehicle(db, body.vehicleId)]);
  if (!customer) throw notFound('Customer', body.customerId);
  if (!vehicle) throw notFound('Vehicle', body.vehicleId);
  if (vehicle.customerId !== customer.id) {
    throw new DomainError('VEHICLE_NOT_OWNED', 422, `Vehicle ${vehicle.id} does not belong to customer ${customer.id}`);
  }

  const plan = await resolveDayPlan(db, clock, planInput(body)); // 404s, SERVICE_NOT_APPLICABLE, OUTSIDE_BOOKING_HORIZON
  const { dealership, spec } = plan;
  const tz = dealership.timezone;
  const { startMin, endMin } = validateTarget(plan, body.date, body.startTime);
  ctx.channel = plan.isSameDay ? 'SAME_DAY' : 'ADVANCE';
  const startAt = toInstant(body.date, startMin, tz);
  const endAt = toInstant(body.date, endMin, tz);
  const startTime = formatLocalTime(startMin);
  const endTime = formatLocalTime(endMin);

  // Every attempt that passes validation is recorded; history renders later ones as "Customer chose ...".
  await db.insert(bookingEvents).values({
    sessionId: body.bookingSessionId,
    type: 'SLOT_REQUESTED',
    detail: {
      date: body.date,
      startTime,
      endTime,
      dealershipId: dealership.id,
      serviceTypeCode: spec.code,
      vehicleId: vehicle.id,
    },
    occurredAt: clock.now(),
  });

  // ---- steps 2-7 ----
  let appointmentId: string;
  const telemetry = getTelemetry();
  const reserveElapsed = startTimer();
  try {
    appointmentId = await db.transaction(async (tx) => {
      const lockElapsed = startTimer();
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${dealership.id}:${body.date}`}::text))`);
      telemetry.observeLockWait(lockElapsed());

      // A concurrent request with the same key may have committed while we waited for the lock.
      if (idempotencyKey) {
        const [dup] = await tx
          .select({ id: appointments.id })
          .from(appointments)
          .where(eq(appointments.idempotencyKey, idempotencyKey));
        if (dup) throw new IdempotentReplay(dup.id);
      }

      // Fresh view under the lock: DayContext, parts and quota are re-read inside the transaction.
      const fresh = await resolveDayPlan(tx, clock, planInput(body));
      if (fresh.sameDay?.blocked === 'PARTS_UNAVAILABLE') throw new CheckFailure('PARTS_UNAVAILABLE');
      if (fresh.sameDay?.blocked === 'SERVICE_NOT_EXPRESS') {
        throw new DomainError('SERVICE_NOT_EXPRESS', 422, 'Service is not available for same-day booking');
      }
      if (fresh.sameDay?.blocked === 'PAST_CUTOFF' || (fresh.sameDay && startMin < fresh.sameDay.earliestStart)) {
        throw new DomainError('LEAD_TIME_NOT_MET', 422, 'Same-day lead time is no longer met for this start time');
      }

      // step 4: the vehicle cannot be in two places at once (any dealership)
      const [clash] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.vehicleId, vehicle.id),
            eq(appointments.status, 'CONFIRMED'),
            lt(appointments.startAt, endAt),
            gt(appointments.endAt, startAt),
          ),
        )
        .limit(1);
      if (clash) throw new CheckFailure('VEHICLE_ALREADY_BOOKED');

      // step 3/5: full-duration check on the fresh DayContext
      const slot = checkWindow(fresh.day, fresh.spec, startMin);
      if (slot.status !== 'AVAILABLE' || !slot.proposed) throw new CheckFailure(slot.status);
      const bay = fresh.day.bays.find((b) => b.id === slot.proposed!.bayId)!;
      const tech = fresh.day.technicians.find((t) => t.id === slot.proposed!.technicianId)!;

      // step 6: same-day parts, conditional UPDATE guards against over-reservation
      const lines = fresh.isSameDay ? (fresh.parts?.lines ?? []) : [];
      for (const line of lines) {
        const reserved = await tx
          .update(inventory)
          .set({ reserved: sql`${inventory.reserved} + ${line.qty}`, updatedAt: clock.now() })
          .where(
            and(
              eq(inventory.dealershipId, dealership.id),
              eq(inventory.sku, line.sku),
              sql`${inventory.onHand} - ${inventory.reserved} >= ${line.qty}`,
            ),
          )
          .returning({ sku: inventory.sku });
        if (reserved.length === 0) throw new CheckFailure('PARTS_UNAVAILABLE');
      }

      // step 7: appointment + parts + events
      const seq = await tx.execute<{ n: string }>(sql`select nextval('appointment_ref_seq') as n`);
      const n = Number(seq.rows[0]!.n) % 10000;
      const reference = `APT-${body.date.replaceAll('-', '')}-${String(n).padStart(4, '0')}`;
      const now = clock.now();

      const [row] = await tx
        .insert(appointments)
        .values({
          reference,
          status: 'CONFIRMED',
          channel: fresh.isSameDay ? 'SAME_DAY' : 'ADVANCE',
          customerId: customer.id,
          vehicleId: vehicle.id,
          dealershipId: dealership.id,
          serviceTypeCode: spec.code,
          technicianId: tech.id,
          serviceBayId: bay.id,
          startAt,
          endAt,
          durationMin: spec.durationMin,
          bookingSessionId: body.bookingSessionId,
          idempotencyKey: idempotencyKey ?? null,
          createdAt: now,
        })
        .returning({ id: appointments.id });
      const id = row!.id;

      if (lines.length > 0) {
        await tx.insert(appointmentParts).values(lines.map((l) => ({ appointmentId: id, sku: l.sku, qty: l.qty })));
      }
      const base = { sessionId: body.bookingSessionId, appointmentId: id, occurredAt: now };
      await tx.insert(bookingEvents).values([
        {
          ...base,
          type: 'CHECK_PASSED',
          detail: {
            bayId: bay.id,
            bayName: bay.name,
            technicianId: tech.id,
            technicianName: tech.name,
            startTime,
            endTime,
          },
        },
        {
          ...base,
          type: 'RESOURCES_RESERVED',
          detail: { bayId: bay.id, technicianId: tech.id, partsReserved: lines.length > 0 },
        },
        { ...base, type: 'APPOINTMENT_CREATED', detail: { reference, channel: fresh.isSameDay ? 'SAME_DAY' : 'ADVANCE' } },
      ]);
      return id;
    });
    telemetry.observeReserve(reserveElapsed());
  } catch (err) {
    telemetry.observeReserve(reserveElapsed());
    if (err instanceof IdempotentReplay) {
      return replay((await loadAppointmentDetail(db, { id: err.appointmentId }))!, body);
    }
    if (idempotencyKey && !(err instanceof DomainError)) {
      // A concurrent request with the same key may have won (unique violation, or its own rows tripping an
      // exclusion constraint): the key's original appointment is the answer, not an error.
      const existing = await findByKey(db, idempotencyKey);
      if (existing) return replay(existing, body);
    }
    let failure: CheckFailure | null = null;
    if (err instanceof CheckFailure) failure = err;
    else if (pgErrorCode(err) === '23P01') {
      failure = new CheckFailure(pgConstraint(err) === 'no_vehicle_overlap' ? 'VEHICLE_ALREADY_BOOKED' : 'CONFLICT');
    }
    if (!failure) throw err;
    throw await failBooking(deps, plan, body, startMin, failure.reason);
  }

  return { created: true, appointment: (await loadAppointmentDetail(db, { id: appointmentId }))! };
}

/** After the rollback: alternatives (slot conflicts only), CHECK_FAILED event, then the 409 to throw. */
export async function failBooking(
  deps: { db: Db; clock: Clock },
  plan: DayPlan,
  body: Pick<CreateAppointmentRequest, 'bookingSessionId'>,
  startMin: number,
  reason: FailReason,
): Promise<DomainError> {
  const { db, clock } = deps;
  let alternatives: AlternativeSlot[] = [];
  const isSlotConflict = reason !== 'PARTS_UNAVAILABLE' && reason !== 'VEHICLE_ALREADY_BOOKED';
  if (isSlotConflict) alternatives = await loadAlternatives(db, clock, plan, startMin);

  await db.insert(bookingEvents).values({
    sessionId: body.bookingSessionId,
    type: 'CHECK_FAILED',
    detail: {
      reason,
      skill: plan.spec.requiredSkill,
      startTime: formatLocalTime(startMin),
      endTime: formatLocalTime(startMin + plan.spec.durationMin),
      alternativeCount: alternatives.length,
      alternatives,
    },
    occurredAt: clock.now(),
  });

  if (reason === 'PARTS_UNAVAILABLE') {
    return new DomainError('PARTS_UNAVAILABLE', 409, `Parts for ${plan.service.name} are not in stock at ${plan.dealership.name} today`);
  }
  if (reason === 'VEHICLE_ALREADY_BOOKED') {
    return new DomainError('VEHICLE_ALREADY_BOOKED', 409, 'This vehicle already has an overlapping appointment');
  }
  return new DomainError('SLOT_UNAVAILABLE', 409, 'The requested window is not available for its full duration', {
    ...(reason !== 'CONFLICT' ? { reason } : {}),
    alternatives,
  });
}
