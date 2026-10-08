import { computeSlots } from './engine.js';
import { DEFAULT_ALTERNATIVES_LIMIT } from './types.js';
import type { DatedDay, DatedSlot, ServiceSpec } from './types.js';

export const findAlternatives = (
  days: DatedDay[],
  service: ServiceSpec,
  after: { date: string; start: number },
  limit: number = DEFAULT_ALTERNATIVES_LIMIT,
): DatedSlot[] => {
  const out: DatedSlot[] = [];
  for (const { date, day } of days) {
    if (date < after.date) continue;
    for (const slot of computeSlots(day, service)) {
      if (out.length >= limit) return out;
      if (slot.status !== 'AVAILABLE') continue;
      if (date === after.date && slot.start <= after.start) continue;
      out.push({ date, slot });
    }
  }
  return out;
};
