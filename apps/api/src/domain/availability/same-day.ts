import type { EvaluateSameDay, SameDayQuotaCap } from './types.js';

export const sameDayQuotaCap: SameDayQuotaCap = (bayCount, quotaPct) =>
  quotaPct === 0 ? 0 : Math.max(1, Math.floor((bayCount * quotaPct) / 100));

export const evaluateSameDay: EvaluateSameDay = (input) => {
  if (!input.isSameDay) {
    return { blocked: null, earliestStart: input.opensAt, quotaCap: Infinity };
  }
  const steps = Math.max(0, Math.ceil((input.nowMin + input.leadMin - input.opensAt) / input.stepMin));
  const earliestStart = input.opensAt + steps * input.stepMin;
  const quotaCap = sameDayQuotaCap(input.bayCount, input.quotaPct);

  if (!input.isExpress) return { blocked: 'SERVICE_NOT_EXPRESS', earliestStart, quotaCap };
  if (!input.partsAvailable) return { blocked: 'PARTS_UNAVAILABLE', earliestStart, quotaCap };
  if (earliestStart + input.durationMin > input.closesAt) {
    return { blocked: 'PAST_CUTOFF', earliestStart, quotaCap };
  }
  return { blocked: null, earliestStart, quotaCap };
};
