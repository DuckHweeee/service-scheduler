// POST /appointments/:reference/reschedule — SPEC §6.5 / ADR-006. Updates the appointment row in place:
//   1. load + reschedulable check, validate the target like booking, SLOT_REQUESTED (own session, not in history)
//   2. BEGIN; advisory locks on the old and new dealership-day, ascending key order (one lock when equal)
//   3. re-read the appointment and the target day plan EXCLUDING it; 4. vehicle overlap (other rows); 5. window check
//   6. parts by channel transition; 7. guarded UPDATE + APPOINTMENT_RESCHEDULED event, COMMIT.
//   Failures roll back; CHECK_FAILED is written after the rollback. 23P01 is the backstop (maps to 409).
import type { AppointmentDetail, RescheduleAppointmentRequest } from '@scheduler/contracts';
import { and, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { appointmentParts, appointments, bookingEvents, inventory } from '../db/schema.js';
import { checkWindow } from '../domain/availability/index.js';
import { DomainError, notFound } from '../domain/errors.js';
import { formatLocalTime, localDateOf, localMinutesOf, parseLocalTime, toInstant } from '../domain/time.js';
import { getTelemetry, startTimer, type RescheduleAttempt } from '../observability/telemetry.js';
import { pgErrorCode } from '../plugins/error-handler.js';
import { getAppointmentDetail } from './appointment-query.js';
import { CheckFailure, failBooking, pgConstraint, validateTarget } from './booking.js';
import { resolveDayPlan } from './day-plan.js';
import { releaseParts } from './parts-release.js';

type Appt = typeof appointments.$inferSelect;
type Ctx = { dealershipId?: string; serviceTypeCode?: string; unchanged: boolean };

const notReschedulable = (reference: string, why: string) =>
  new DomainError('APPOINTMENT_NOT_RESCHEDULABLE', 409, `Appointment ${reference} ${why} and cannot be rescheduled`);

const assertReschedulable = (a: Appt, now: Date): void => {
  if (a.status !== 'CONFIRMED') throw notReschedulable(a.reference, `is ${a.status}`);
  if (a.checkedInAt) throw notReschedulable(a.reference, 'is already checked in');
  if (a.startAt.getTime() <= now.getTime()) throw notReschedulable(a.reference, 'has already started or passed');
};

/** Observability wrapper: one span + one `reschedule_attempts_total` increment per call, no PII in attributes. */
export async function rescheduleAppointment(
  deps: { db: Db; clock: Clock },
  reference: string,
  body: RescheduleAppointmentRequest,
): Promise<AppointmentDetail> {
  const telemetry = getTelemetry();
  const elapsed = startTimer();
  const ctx: Ctx = { unchanged: false };
  return telemetry.withSpan('booking.reschedule', {}, async (span) => {
    let attempt: RescheduleAttempt;
    try {
      const result = await reschedule(deps, reference, body, ctx);
      attempt = { outcome: ctx.unchanged ? 'unchanged' : 'rescheduled', reason: 'none' };
      return result;
    } catch (err) {
      const e = err instanceof DomainError ? err : undefined;
      attempt = {
        outcome: e && e.status !== 409 ? 'invalid' : 'rejected',
        reason: e ? (e.extras.reason ?? e.code) : 'INTERNAL_ERROR',
      };
      throw err;
    } finally {
      // `attempt` is always assigned: both paths above set it before leaving the try block.
      const done = attempt!;
      span.setAttributes({ 'booking.outcome': done.outcome, 'booking.reason': done.reason });
      telemetry.rescheduleAttempt({
        ...done,
        dealershipId: ctx.dealershipId,
        serviceTypeCode: ctx.serviceTypeCode,
        durationMs: Math.round(elapsed() * 1000),
      });
    }
  });
}

async function reschedule(
  deps: { db: Db; clock: Clock },
  reference: string,
  body: RescheduleAppointmentRequest,
  ctx: Ctx,
): Promise<AppointmentDetail> {
  const { db, clock } = deps;

  // ---- step 1: load, reschedulable, target validation (no events on validation errors) ----
  const [appt] = await db.select().from(appointments).where(eq(appointments.reference, reference));
  if (!appt) throw notFound('Appointment', reference);
  ctx.dealershipId = appt.dealershipId;
  ctx.serviceTypeCode = appt.serviceTypeCode;
  assertReschedulable(appt, clock.now());

  const planInput = {
    dealershipId: appt.dealershipId,
    serviceTypeCode: appt.serviceTypeCode,
    vehicleId: appt.vehicleId,
    date: body.date,
    excludeAppointmentId: appt.id,
    partsHeld: appt.channel === 'SAME_DAY',
  };
  const plan = await resolveDayPlan(db, clock, planInput);
  const tz = plan.dealership.timezone;
  const oldDate = localDateOf(appt.startAt, tz);
  const oldStartMin = localMinutesOf(appt.startAt, tz);

  // Natural idempotency (§6.5) before the target rules: the current slot was valid when it was booked, and an
  // ADVANCE booking whose day has become "today" must not start failing same-day rules for not moving (W5-Q2).
  if (body.date === oldDate && parseLocalTime(body.startTime) === oldStartMin) {
    ctx.unchanged = true; // nothing changes, no event
    return getAppointmentDetail(db, reference);
  }
  const { startMin, endMin } = validateTarget(plan, body.date, body.startTime);

  const startAt = toInstant(body.date, startMin, tz);
  const endAt = toInstant(body.date, endMin, tz);
  const startTime = formatLocalTime(startMin);
  const endTime = formatLocalTime(endMin);

  await db.insert(bookingEvents).values({
    sessionId: body.bookingSessionId,
    type: 'SLOT_REQUESTED',
    detail: {
      date: body.date,
      startTime,
      endTime,
      dealershipId: plan.dealership.id,
      serviceTypeCode: plan.spec.code,
      vehicleId: appt.vehicleId,
      rescheduleOf: reference,
    },
    occurredAt: clock.now(),
  });

  // ---- steps 2-7 ----
  const telemetry = getTelemetry();
  const reserveElapsed = startTimer();
  try {
    await db.transaction(async (tx) => {
      const lockElapsed = startTimer();
      const keys = [...new Set([`${appt.dealershipId}:${oldDate}`, `${appt.dealershipId}:${body.date}`])].sort();
      for (const key of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}::text))`);
      telemetry.observeLockWait(lockElapsed());

      // Fresh view under the locks. A change to this very appointment (cancel, check-in, no-show, or another
      // reschedule that moved it off the day we locked) means our locks may not cover it any more: refuse.
      // FOR UPDATE takes the appointment row before any inventory row, the same order as cancel / check-in / the
      // no-show sweeper (row, then parts). Releasing parts first deadlocked against them (40P01, found by W5-Q2).
      const [cur] = await tx.select().from(appointments).where(eq(appointments.id, appt.id)).for('update');
      if (!cur) throw notFound('Appointment', reference);
      assertReschedulable(cur, clock.now());
      if (localDateOf(cur.startAt, tz) !== oldDate) throw notReschedulable(reference, 'was moved by a concurrent request');

      const fresh = await resolveDayPlan(tx, clock, { ...planInput, partsHeld: cur.channel === 'SAME_DAY' });
      if (fresh.sameDay?.blocked === 'PARTS_UNAVAILABLE') throw new CheckFailure('PARTS_UNAVAILABLE');
      if (fresh.sameDay?.blocked === 'SERVICE_NOT_EXPRESS') {
        throw new DomainError('SERVICE_NOT_EXPRESS', 422, 'Service is not available for same-day booking');
      }
      if (fresh.sameDay?.blocked === 'PAST_CUTOFF' || (fresh.sameDay && startMin < fresh.sameDay.earliestStart)) {
        throw new DomainError('LEAD_TIME_NOT_MET', 422, 'Same-day lead time is no longer met for this start time');
      }

      // step 4: the vehicle cannot be in two places at once — against every OTHER confirmed appointment
      const [clash] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.vehicleId, appt.vehicleId),
            eq(appointments.status, 'CONFIRMED'),
            ne(appointments.id, appt.id),
            lt(appointments.startAt, endAt),
            gt(appointments.endAt, startAt),
          ),
        )
        .limit(1);
      if (clash) throw new CheckFailure('VEHICLE_ALREADY_BOOKED');

      // step 5: full-duration check with this appointment's own resources free
      const slot = checkWindow(fresh.day, fresh.spec, startMin);
      if (slot.status !== 'AVAILABLE' || !slot.proposed) throw new CheckFailure(slot.status);
      const bay = fresh.day.bays.find((b) => b.id === slot.proposed!.bayId)!;
      const tech = fresh.day.technicians.find((t) => t.id === slot.proposed!.technicianId)!;
      const oldBay = fresh.day.bays.find((b) => b.id === cur.serviceBayId);
      const oldTech = fresh.day.technicians.find((t) => t.id === cur.technicianId);
      const now = clock.now();
      const newChannel = fresh.isSameDay ? 'SAME_DAY' : 'ADVANCE';

      // step 6: parts follow the channel (SAME_DAY -> SAME_DAY keeps the existing reservation)
      if (cur.channel === 'ADVANCE' && newChannel === 'SAME_DAY') {
        const lines = fresh.parts?.lines ?? [];
        for (const line of lines) {
          const reserved = await tx
            .update(inventory)
            .set({ reserved: sql`${inventory.reserved} + ${line.qty}`, updatedAt: now })
            .where(
              and(
                eq(inventory.dealershipId, appt.dealershipId),
                eq(inventory.sku, line.sku),
                sql`${inventory.onHand} - ${inventory.reserved} >= ${line.qty}`,
              ),
            )
            .returning({ sku: inventory.sku });
          if (reserved.length === 0) throw new CheckFailure('PARTS_UNAVAILABLE');
        }
        if (lines.length > 0) {
          // (appointment, sku) is the key: a line released by an earlier SAME_DAY -> ADVANCE move is re-activated.
          for (const l of lines) {
            await tx
              .insert(appointmentParts)
              .values({ appointmentId: appt.id, sku: l.sku, qty: l.qty })
              .onConflictDoUpdate({
                target: [appointmentParts.appointmentId, appointmentParts.sku],
                set: { qty: l.qty, releasedAt: null },
              });
          }
        }
      } else if (cur.channel === 'SAME_DAY' && newChannel === 'ADVANCE') {
        await releaseParts(tx, cur, now);
      }

      // step 7: guarded UPDATE, then the audit event in the same transaction
      const updated = await tx
        .update(appointments)
        .set({ startAt, endAt, technicianId: tech.id, serviceBayId: bay.id, channel: newChannel })
        .where(and(eq(appointments.id, appt.id), eq(appointments.status, 'CONFIRMED'), isNull(appointments.checkedInAt)))
        .returning({ id: appointments.id });
      if (updated.length === 0) throw notReschedulable(reference, 'changed while rescheduling');

      await tx.insert(bookingEvents).values({
        sessionId: body.bookingSessionId,
        appointmentId: appt.id,
        type: 'APPOINTMENT_RESCHEDULED',
        detail: {
          from: {
            date: oldDate,
            startTime: formatLocalTime(oldStartMin),
            endTime: formatLocalTime(localMinutesOf(cur.endAt, tz)),
            technicianId: cur.technicianId,
            technicianName: oldTech?.name ?? cur.technicianId,
            bayId: cur.serviceBayId,
            bayName: oldBay?.name ?? cur.serviceBayId,
            channel: cur.channel,
          },
          to: {
            date: body.date,
            startTime,
            endTime,
            technicianId: tech.id,
            technicianName: tech.name,
            bayId: bay.id,
            bayName: bay.name,
            channel: newChannel,
          },
        },
        occurredAt: now,
      });
    });
    telemetry.observeReserve(reserveElapsed());
  } catch (err) {
    telemetry.observeReserve(reserveElapsed());
    let failure: CheckFailure | null = null;
    if (err instanceof CheckFailure) failure = err;
    else if (pgErrorCode(err) === '23P01') {
      failure = new CheckFailure(pgConstraint(err) === 'no_vehicle_overlap' ? 'VEHICLE_ALREADY_BOOKED' : 'CONFLICT');
    }
    if (!failure) throw err;
    throw await failBooking(deps, plan, body, startMin, failure.reason);
  }

  return getAppointmentDetail(db, reference);
}
