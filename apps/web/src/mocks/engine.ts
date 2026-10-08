// Client-side port of the availability engine (SPEC §5) used only by the MSW mocks.
// Times are integer minutes since local midnight; no Date, no I/O.
import type { BayType, SameDayBlock, Skill, SlotStatus } from '@scheduler/contracts';

export interface Interval {
  start: number;
  end: number;
}
export interface BayCtx {
  id: string;
  name: string;
  bayType: BayType;
  busy: Interval[];
}
export interface TechCtx {
  id: string;
  name: string;
  skills: Skill[];
  busy: Interval[];
}
export interface DayContext {
  opensAt: number;
  closesAt: number;
  isWorkingDay: boolean;
  bays: BayCtx[];
  technicians: TechCtx[];
  sameDay: null | { earliestStart: number; quotaCap: number; sameDayBusy: Interval[] };
}
export interface ServiceSpec {
  code: string;
  durationMin: number;
  requiredSkill: Skill;
  allowedBayTypes: BayType[];
}
export interface SlotResult {
  start: number;
  end: number;
  status: SlotStatus;
  proposed: { bay: BayCtx; technician: TechCtx } | null;
}

const overlaps = (b: Interval, start: number, end: number) => b.start < end && start < b.end;
const isFree = (busy: Interval[], start: number, end: number) => !busy.some((b) => overlaps(b, start, end));
const busyMinutes = (busy: Interval[]) => busy.reduce((n, b) => n + (b.end - b.start), 0);

function evaluate(day: DayContext, service: ServiceSpec, t: number): SlotResult {
  const end = t + service.durationMin;
  const bays = day.bays.filter((b) => service.allowedBayTypes.includes(b.bayType) && isFree(b.busy, t, end));
  const techs = day.technicians.filter(
    (x) => x.skills.includes(service.requiredSkill) && isFree(x.busy, t, end),
  );

  let status: SlotStatus =
    bays.length && techs.length
      ? 'AVAILABLE'
      : bays.length
        ? 'NO_QUALIFIED_TECHNICIAN'
        : techs.length
          ? 'NO_BAY'
          : 'FULLY_BOOKED';

  if (status === 'AVAILABLE' && day.sameDay) {
    const used = day.sameDay.sameDayBusy.filter((b) => overlaps(b, t, end)).length;
    if (used >= day.sameDay.quotaCap) status = 'SAME_DAY_QUOTA_REACHED';
  }
  if (status !== 'AVAILABLE') return { start: t, end, status, proposed: null };

  // SPEC §5.3: fewest skills, then fewest busy minutes, then id.
  const technician = [...techs].sort(
    (a, b) =>
      a.skills.length - b.skills.length ||
      busyMinutes(a.busy) - busyMinutes(b.busy) ||
      a.id.localeCompare(b.id),
  )[0]!;
  // Bay: lowest index in allowedBayTypes, then id.
  const bay = [...bays].sort(
    (a, b) =>
      service.allowedBayTypes.indexOf(a.bayType) - service.allowedBayTypes.indexOf(b.bayType) ||
      a.id.localeCompare(b.id),
  )[0]!;
  return { start: t, end, status, proposed: { bay, technician } };
}

export function computeSlots(day: DayContext, service: ServiceSpec, step = 30): SlotResult[] {
  if (!day.isWorkingDay) return [];
  const out: SlotResult[] = [];
  for (let t = day.opensAt; t + service.durationMin <= day.closesAt; t += step) {
    if (day.sameDay && t < day.sameDay.earliestStart) continue;
    out.push(evaluate(day, service, t));
  }
  return out;
}

export function checkWindow(day: DayContext, service: ServiceSpec, start: number): SlotResult {
  if (start < day.opensAt || start + service.durationMin > day.closesAt) {
    return { start, end: start + service.durationMin, status: 'FULLY_BOOKED', proposed: null };
  }
  return evaluate(day, service, start);
}

export function findAlternatives(
  days: { date: string; day: DayContext }[],
  service: ServiceSpec,
  after: { date: string; start: number },
  limit = 5,
): { date: string; slot: SlotResult }[] {
  const out: { date: string; slot: SlotResult }[] = [];
  for (const { date, day } of days) {
    if (date < after.date) continue;
    for (const slot of computeSlots(day, service)) {
      if (date === after.date && slot.start <= after.start) continue;
      if (slot.status !== 'AVAILABLE') continue;
      out.push({ date, slot });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function sameDayQuotaCap(bayCount: number, quotaPct: number): number {
  if (quotaPct === 0) return 0;
  return Math.max(1, Math.floor((bayCount * quotaPct) / 100));
}

export interface SameDayPolicyInput {
  isExpress: boolean;
  partsAvailable: boolean;
  nowMin: number;
  leadMin: number;
  opensAt: number;
  closesAt: number;
  durationMin: number;
  stepMin: number;
  bayCount: number;
  quotaPct: number;
}

export function evaluateSameDay(i: SameDayPolicyInput): {
  blocked: SameDayBlock | null;
  earliestStart: number | null;
  quotaCap: number;
} {
  const quotaCap = sameDayQuotaCap(i.bayCount, i.quotaPct);
  if (!i.isExpress) return { blocked: 'SERVICE_NOT_EXPRESS', earliestStart: null, quotaCap };
  if (!i.partsAvailable) return { blocked: 'PARTS_UNAVAILABLE', earliestStart: null, quotaCap };
  const raw = i.nowMin + i.leadMin;
  const earliestStart = Math.max(i.opensAt, i.opensAt + Math.ceil((raw - i.opensAt) / i.stepMin) * i.stepMin);
  if (earliestStart + i.durationMin > i.closesAt) return { blocked: 'PAST_CUTOFF', earliestStart, quotaCap };
  return { blocked: null, earliestStart, quotaCap };
}
