import type { SameDayInfo, SameDayBlock } from '@scheduler/contracts';
import { fmtMin, parseMin } from '../lib/time.js';
import type { DayContext } from './engine.js';
import { evaluateSameDay } from './engine.js';
import { mockNow } from './scenario.js';
import { getDealership } from './store.js';
import { buildDay, partsAvailable, withSameDay } from './support.js';
import type { ServiceLike } from './support.js';

export interface ResolvedDay {
  now: { ms: number; date: string; minutes: number };
  day: DayContext;
  /** Earliest start (minutes) when the same-day channel applies and is not blocked. */
  earliestStart: number | null;
  blocked: SameDayBlock | null;
  /** Response `sameDay` block; null for future dates and non-working days. */
  sameDay: SameDayInfo | null;
}

/** Day context for (dealership, date, service, vehicle model) with the SPEC §5.4 same-day policy applied for today. */
export function resolveDay(
  dealershipId: string,
  date: string,
  service: ServiceLike & { isExpress: boolean },
  modelName: string,
): ResolvedDay {
  const d = getDealership(dealershipId)!;
  const now = mockNow(d.timezone);
  const base = buildDay(dealershipId, date);
  if (date !== now.date || !base.isWorkingDay)
    return { now, day: base, earliestStart: null, blocked: null, sameDay: null };

  const policy = evaluateSameDay({
    isExpress: service.isExpress,
    partsAvailable: partsAvailable(dealershipId, service.code, modelName),
    nowMin: now.minutes,
    leadMin: d.sameDayPolicy.leadTimeMin,
    opensAt: parseMin(d.opensAt),
    closesAt: parseMin(d.closesAt),
    durationMin: service.durationMin,
    stepMin: 30,
    bayCount: d.bayCount,
    quotaPct: d.sameDayPolicy.quotaPct,
  });
  const day = policy.blocked
    ? base
    : withSameDay(base, dealershipId, date, policy.earliestStart!, policy.quotaCap);
  return {
    now,
    day,
    earliestStart: policy.blocked ? null : policy.earliestStart,
    blocked: policy.blocked,
    sameDay: {
      isSameDay: true,
      blocked: policy.blocked,
      earliestStartTime: policy.earliestStart === null ? null : fmtMin(policy.earliestStart),
      leadTimeMin: d.sameDayPolicy.leadTimeMin,
      quotaCap: policy.quotaCap,
      lateGraceMin: d.sameDayPolicy.lateGraceMin,
    },
  };
}
