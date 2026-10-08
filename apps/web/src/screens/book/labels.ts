import type { AvailabilitySlot, BayType, Skill, SlotStatus } from '@scheduler/contracts';

export const SKILL_LABEL: Record<Skill, string> = {
  GENERAL: 'General',
  BRAKES: 'Brakes',
  ALIGNMENT: 'Alignment',
  EV_HIGH_VOLTAGE: 'EV high-voltage',
};

export const BAY_TYPE_LABEL: Record<BayType, string> = {
  GENERAL_LIFT: 'General lift',
  ALIGNMENT_RACK: 'Alignment rack',
  EV_ISOLATED: 'EV isolated bay',
  WASH_BAY: 'Wash bay',
};

export const SLOT_STATUS_LABEL: Record<SlotStatus, string> = {
  AVAILABLE: 'Available',
  NO_QUALIFIED_TECHNICIAN: 'No qualified tech',
  NO_BAY: 'No bay free',
  FULLY_BOOKED: 'Fully booked',
  SAME_DAY_QUOTA_REACHED: 'Same-day quota full',
};

/** Visible status text of a slot. Available same-day slots read "Express slot". */
export function slotLabel(slot: Pick<AvailabilitySlot, 'status' | 'isExpress'>): string {
  return slot.status === 'AVAILABLE' && slot.isExpress ? 'Express slot' : SLOT_STATUS_LABEL[slot.status];
}

/** Accessible name of a slot button, e.g. "08:00 to 10:00, No qualified tech". */
export function slotAriaLabel(
  slot: Pick<AvailabilitySlot, 'startTime' | 'endTime' | 'status' | 'isExpress'>,
): string {
  return `${slot.startTime} to ${slot.endTime}, ${slotLabel(slot)}`;
}
