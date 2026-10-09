// SPEC §6.2 cancellation: CONFIRMED + future + not checked in → CANCELLED, release reserved parts, audit event.
import type { AppointmentDetail } from '@scheduler/contracts';
import { and, eq, isNull } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { appointments, bookingEvents } from '../db/schema.js';
import { DomainError, notFound } from '../domain/errors.js';
import { getAppointmentDetail } from './appointment-query.js';
import { releaseParts } from './parts-release.js';

export async function cancelAppointment(
  deps: { db: Db; clock: Clock },
  reference: string,
  reason?: string,
): Promise<AppointmentDetail> {
  const { db, clock } = deps;
  const now = clock.now();

  await db.transaction(async (tx) => {
    const [appt] = await tx.select().from(appointments).where(eq(appointments.reference, reference));
    if (!appt) throw notFound('Appointment', reference);
    if (appt.status === 'CANCELLED') return; // idempotent
    if (appt.status !== 'CONFIRMED') {
      throw new DomainError('APPOINTMENT_NOT_CANCELLABLE', 409, `Appointment ${reference} is ${appt.status} and cannot be cancelled`);
    }
    if (appt.startAt.getTime() <= now.getTime()) {
      throw new DomainError('APPOINTMENT_NOT_CANCELLABLE', 409, `Appointment ${reference} has already started or passed`);
    }
    if (appt.checkedInAt) {
      throw new DomainError('APPOINTMENT_NOT_CANCELLABLE', 409, `Appointment ${reference} is already checked in`);
    }

    // The guard makes races safe: only one of concurrent cancels / check-in / no-show release can match.
    const updated = await tx
      .update(appointments)
      .set({ status: 'CANCELLED', cancelledAt: now, cancelReason: reason ?? null })
      .where(and(eq(appointments.id, appt.id), eq(appointments.status, 'CONFIRMED'), isNull(appointments.checkedInAt)))
      .returning({ id: appointments.id });
    if (updated.length === 0) {
      // Lost a race: another cancel is the idempotent case; a check-in or no-show that committed first wins.
      const [current] = await tx
        .select({ status: appointments.status })
        .from(appointments)
        .where(eq(appointments.id, appt.id));
      if (current?.status === 'CANCELLED') return;
      throw new DomainError('APPOINTMENT_NOT_CANCELLABLE', 409, `Appointment ${reference} changed while cancelling and cannot be cancelled`);
    }

    const released = await releaseParts(tx, appt, now);

    await tx.insert(bookingEvents).values({
      sessionId: appt.bookingSessionId,
      appointmentId: appt.id,
      type: 'APPOINTMENT_CANCELLED',
      detail: { reason: reason ?? null, partsReleased: released > 0 },
      occurredAt: now,
    });
  });

  return getAppointmentDetail(db, reference);
}
