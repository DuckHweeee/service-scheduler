// SPEC §5.1 — fixed in Wave 0. Owned by Opus; A2 implements against these types and must not change them.
// All times are integer minutes since local midnight in the dealership's timezone.
import type { BayType, SameDayBlock, Skill, SlotStatus } from '@scheduler/contracts';

/** Half-open interval [start, end) in local minutes. */
export interface Interval {
  start: number;
  end: number;
}

export interface BayState {
  id: string;
  name: string;
  bayType: BayType;
  busy: Interval[];
}

export interface TechnicianState {
  id: string;
  name: string;
  skills: Skill[];
  busy: Interval[];
}

export interface SameDayContext {
  /** First allowed start (already aligned to the slot grid). */
  earliestStart: number;
  /** Max concurrent CONFIRMED same-day appointments overlapping any window. */
  quotaCap: number;
  /** Intervals of CONFIRMED appointments booked through the SAME_DAY channel on this day. */
  sameDayBusy: Interval[];
}

export interface DayContext {
  opensAt: number;
  closesAt: number;
  isWorkingDay: boolean;
  bays: BayState[];
  technicians: TechnicianState[];
  /** null for days after today. */
  sameDay: SameDayContext | null;
}

export interface ServiceSpec {
  code: string;
  durationMin: number;
  requiredSkill: Skill;
  /** Preference order matters (SPEC §5.3). */
  allowedBayTypes: BayType[];
}

export interface ProposedResources {
  bayId: string;
  technicianId: string;
}

export interface SlotResult {
  start: number;
  end: number;
  status: SlotStatus;
  /** Non-null iff status === 'AVAILABLE'. */
  proposed: ProposedResources | null;
}

export interface DatedDay {
  /** Local date `YYYY-MM-DD`. */
  date: string;
  day: DayContext;
}

export interface DatedSlot {
  date: string;
  slot: SlotResult;
}

export interface SameDayPolicyInput {
  isSameDay: boolean;
  isExpress: boolean;
  partsAvailable: boolean;
  /** Current local time in minutes since midnight. */
  nowMin: number;
  leadMin: number;
  opensAt: number;
  closesAt: number;
  durationMin: number;
  stepMin: number;
  bayCount: number;
  quotaPct: number;
}

export interface SameDayDecision {
  blocked: SameDayBlock | null;
  /** Grid-aligned earliest start; `opensAt` when not same-day. */
  earliestStart: number;
  /** `Infinity` when not same-day. */
  quotaCap: number;
}

export const DEFAULT_STEP_MIN = 30;
export const DEFAULT_ALTERNATIVES_LIMIT = 5;

export type ComputeSlots = (day: DayContext, service: ServiceSpec, stepMin?: number) => SlotResult[];
export type CheckWindow = (day: DayContext, service: ServiceSpec, start: number) => SlotResult;
export type FindAlternatives = (
  days: DatedDay[],
  service: ServiceSpec,
  after: { date: string; start: number },
  limit?: number,
) => DatedSlot[];
export type EvaluateSameDay = (input: SameDayPolicyInput) => SameDayDecision;
export type SameDayQuotaCap = (bayCount: number, quotaPct: number) => number;
