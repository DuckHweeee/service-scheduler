// SPEC §6.3 check-in: CONFIRMED → checked in, or (same-day, past grace) → NO_SHOW + 409 LATE_ARRIVAL.
import type { AppointmentDetail } from '@scheduler/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { Db, Tx } from '../db/client.js';
import { appointments, bookingEvents, dealerships } from '../db/schema.js';
import { DomainError, notFound } from '../domain/errors.js';
import { formatLocalTime, localMinutesOf } from '../domain/time.js';
import { getAppointmentDetail } from './appointment-query.js';
import { getTelemetry } from '../observability/telemetry.js';
import { releaseParts } from './parts-release.js';

type ApptRow = typeof appointments.$inferSelect;

/**
 * Marks a CONFIRMED, unchecked appointment as NO_SHOW (late arrival), releases its parts and writes the event.
 * The guarded UPDATE means a concurrent check-in/cancel/sweeper wins cleanly; returns false when this call lost.
 */
export async function markLateNoShow(
  tx: Tx,
  appt: Pick<ApptRow, 'id' | 'dealershipId' | 'bookingSessionId'>,
  graceMin: number,
  now: Date,
): Promise<boolean> {
  const updated = await tx
    .update(appointments)
    .set({ status: 'NO_SHOW' })
    .where(
      and(
        eq(appointments.id, appt.id),
        eq(appointments.status, 'CONFIRMED'),
        isNull(appointments.checkedInAt),
      ),
    )
    .returning({ id: appointments.id });
  if (updated.length === 0) return false;
  await releaseParts(tx, appt, now);
  await tx.insert(bookingEvents).values({
    sessionId: appt.bookingSessionId,
    appointmentId: appt.id,
    type: 'APPOINTMENT_NO_SHOW',
    detail: { reason: 'LATE_ARRIVAL', graceMin },
    occurredAt: now,
  });
  return true;
}

export async function checkInAppointment(
  deps: { db: Db; clock: Clock },
  reference: string,
): Promise<AppointmentDetail> {
  const { db, clock } = deps;
  const now = clock.now();

  const lateMessage = await db.transaction(async (tx): Promise<string | null> => {
    const [row] = await tx
      .select({ appt: appointments, graceMin: dealerships.lateGraceMin, timezone: dealerships.timezone })
      .from(appointments)
      .innerJoin(dealerships, eq(dealerships.id, appointments.dealershipId))
      .where(eq(appointments.reference, reference));
    if (!row) throw notFound('Appointment', reference);
    const { appt, graceMin, timezone } = row;
    if (appt.status !== 'CONFIRMED' || appt.checkedInAt) {
      throw new DomainError(
        'APPOINTMENT_NOT_ACTIVE',
        409,
        appt.checkedInAt
          ? `Appointment ${reference} is already checked in`
          : `Appointment ${reference} is ${appt.status}`,
      );
    }

    const late = appt.channel === 'SAME_DAY' && now.getTime() > appt.startAt.getTime() + graceMin * 60_000;
    if (late) {
      if (!(await markLateNoShow(tx, appt, graceMin, now))) {
        throw new DomainError('APPOINTMENT_NOT_ACTIVE', 409, `Appointment ${reference} is no longer active`);
      }
      const minutes = Math.floor((now.getTime() - appt.startAt.getTime()) / 60_000);
      const start = formatLocalTime(localMinutesOf(appt.startAt, timezone));
      return `Arrived ${minutes} minutes after the ${start} start; same-day bookings are released after ${graceMin} minutes.`;
    }

    const updated = await tx
      .update(appointments)
      .set({ checkedInAt: now })
      .where(
        and(
          eq(appointments.id, appt.id),
          eq(appointments.status, 'CONFIRMED'),
          isNull(appointments.checkedInAt),
        ),
      )
      .returning({ id: appointments.id });
    if (updated.length === 0) {
      throw new DomainError('APPOINTMENT_NOT_ACTIVE', 409, `Appointment ${reference} is no longer active`);
    }
    await tx.insert(bookingEvents).values({
      sessionId: appt.bookingSessionId,
      appointmentId: appt.id,
      type: 'CHECKED_IN',
      detail: {},
      occurredAt: now,
    });
    return null;
  });

  // The NO_SHOW transition is committed above; only now surface the 409.
  if (lateMessage) {
    getTelemetry().noShowReleased(1);
    throw new DomainError('LATE_ARRIVAL', 409, lateMessage);
  }
  return getAppointmentDetail(db, reference);
}
