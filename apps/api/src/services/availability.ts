// A3: availability read model (SPEC §6). Thin glue over resolveDayPlan + the pure engine.
import type { AvailabilityQuery, AvailabilityResponse } from '@scheduler/contracts';
import type { Clock } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import { computeSlots } from '../domain/availability/index.js';
import { resolveDayPlan, toSameDayInfo, toSlotDto } from './day-plan.js';

export async function getAvailability(
  db: DbOrTx,
  clock: Clock,
  dealershipId: string,
  query: AvailabilityQuery,
): Promise<AvailabilityResponse> {
  const plan = await resolveDayPlan(db, clock, {
    dealershipId,
    serviceTypeCode: query.serviceType,
    vehicleId: query.vehicleId,
    date: query.date,
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
