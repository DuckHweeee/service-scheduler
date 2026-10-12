// A3: availability read model (SPEC §6). Thin glue over resolveDayPlan + the pure engine.
import type { AvailabilityQuery, AvailabilityResponse } from '@scheduler/contracts';
import type { Clock } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import { eq } from 'drizzle-orm';
import { appointments } from '../db/schema.js';
import { DomainError, notFound } from '../domain/errors.js';
import { getTelemetry, startTimer } from '../observability/telemetry.js';
import { computeSlots } from '../domain/availability/index.js';
import { resolveDayPlan, toSameDayInfo, toSlotDto } from './day-plan.js';

export async function getAvailability(
  db: DbOrTx,
  clock: Clock,
  dealershipId: string,
  query: AvailabilityQuery,
): Promise<AvailabilityResponse> {
  const telemetry = getTelemetry();
  const elapsed = startTimer();
  return telemetry.withSpan('availability.compute', { 'dealership.id': dealershipId, 'service.code': query.serviceType }, async (span) => {
    const res = await computeAvailability(db, clock, dealershipId, query);
    const sameDay = res.sameDay?.isSameDay ?? false;
    span.setAttributes({ 'availability.same_day': sameDay, 'availability.slots': res.slots.length });
    telemetry.observeAvailability(elapsed(), sameDay);
    return res;
  });
}

async function computeAvailability(
  db: DbOrTx,
  clock: Clock,
  dealershipId: string,
  query: AvailabilityQuery,
): Promise<AvailabilityResponse> {
  let exclusion: { excludeAppointmentId: string; partsHeld: boolean } | undefined;
  if (query.excludeReference) {
    // Reschedule screen (SPEC §6.5): the appointment must be in the same scope as the grid being asked for.
    const [appt] = await db.select().from(appointments).where(eq(appointments.reference, query.excludeReference));
    if (!appt) throw notFound('Appointment', query.excludeReference);
    if (appt.dealershipId !== dealershipId || appt.serviceTypeCode !== query.serviceType || appt.vehicleId !== query.vehicleId) {
      throw new DomainError(
        'RESCHEDULE_SCOPE_MISMATCH',
        422,
        `Appointment ${appt.reference} can only be rescheduled within its own dealership, service and vehicle`,
      );
    }
    exclusion = { excludeAppointmentId: appt.id, partsHeld: appt.channel === 'SAME_DAY' };
  }
  const plan = await resolveDayPlan(db, clock, {
    dealershipId,
    serviceTypeCode: query.serviceType,
    vehicleId: query.vehicleId,
    date: query.date,
    ...exclusion,
  });
  const blocked = plan.sameDay?.blocked ?? null;
  const slots = !plan.isWorkingDay || blocked ? [] : computeSlots(plan.day, plan.spec).map((s) => toSlotDto(plan, s));
  return {
    dealershipId: plan.dealership.id,
    serviceTypeCode: plan.service.code,
    date: query.date,
    timezone: plan.dealership.timezone,
    isWorkingDay: plan.isWorkingDay,
    durationMin: plan.service.durationMin,
    sameDay: toSameDayInfo(plan),
    slots,
  };
}
