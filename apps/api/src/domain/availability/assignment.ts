import type { BayState, ServiceSpec, TechnicianState } from './types.js';
import { busyMinutes } from './intervals.js';

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** Fewest skills first, then fewest busy minutes that day, then id asc (SPEC §5.3). */
export const pickTechnician = (eligible: TechnicianState[]): TechnicianState =>
  [...eligible].sort(
    (a, b) =>
      a.skills.length - b.skills.length || busyMinutes(a.busy) - busyMinutes(b.busy) || byId(a, b),
  )[0]!;

/** Lowest index in allowedBayTypes first, then id asc (SPEC §5.3). */
export const pickBay = (eligible: BayState[], service: ServiceSpec): BayState =>
  [...eligible].sort(
    (a, b) =>
      service.allowedBayTypes.indexOf(a.bayType) - service.allowedBayTypes.indexOf(b.bayType) ||
      byId(a, b),
  )[0]!;
