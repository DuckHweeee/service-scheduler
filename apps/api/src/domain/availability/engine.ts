import { pickBay, pickTechnician } from './assignment.js';
import { isFree, overlaps } from './intervals.js';
import { DEFAULT_STEP_MIN } from './types.js';
import type { DayContext, ServiceSpec, SlotResult } from './types.js';

const evaluateWindow = (day: DayContext, service: ServiceSpec, start: number): SlotResult => {
  const end = start + service.durationMin;
  const bays = day.bays.filter(
    (b) => service.allowedBayTypes.includes(b.bayType) && isFree(b.busy, start, end),
  );
  const techs = day.technicians.filter(
    (t) => t.skills.includes(service.requiredSkill) && isFree(t.busy, start, end),
  );

  if (bays.length === 0 || techs.length === 0) {
    const status =
      bays.length > 0 ? 'NO_QUALIFIED_TECHNICIAN' : techs.length > 0 ? 'NO_BAY' : 'FULLY_BOOKED';
    return { start, end, status, proposed: null };
  }

  if (day.sameDay) {
    const used = day.sameDay.sameDayBusy.filter((b) => overlaps(b, start, end)).length;
    if (used >= day.sameDay.quotaCap) {
      return { start, end, status: 'SAME_DAY_QUOTA_REACHED', proposed: null };
    }
  }

  return {
    start,
    end,
    status: 'AVAILABLE',
    proposed: { bayId: pickBay(bays, service).id, technicianId: pickTechnician(techs).id },
  };
};

export const computeSlots = (
  day: DayContext,
  service: ServiceSpec,
  stepMin: number = DEFAULT_STEP_MIN,
): SlotResult[] => {
  if (!day.isWorkingDay) return [];
  const slots: SlotResult[] = [];
  for (let t = day.opensAt; t + service.durationMin <= day.closesAt; t += stepMin) {
    if (day.sameDay && t < day.sameDay.earliestStart) continue;
    slots.push(evaluateWindow(day, service, t));
  }
  return slots;
};

export const checkWindow = (day: DayContext, service: ServiceSpec, start: number): SlotResult => {
  const end = start + service.durationMin;
  if (!day.isWorkingDay || start < day.opensAt || end > day.closesAt) {
    return { start, end, status: 'FULLY_BOOKED', proposed: null };
  }
  return evaluateWindow(day, service, start);
};
