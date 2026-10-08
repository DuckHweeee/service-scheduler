// Public surface of the availability engine. Wave 0 stub — A2 replaces the bodies (keep the exported names/types).
import type {
  CheckWindow,
  ComputeSlots,
  EvaluateSameDay,
  FindAlternatives,
  SameDayQuotaCap,
} from './types.js';

export * from './types.js';

const notImplemented = (name: string): never => {
  throw new Error(`availability.${name} not implemented (Wave 1 / A2)`);
};

export const computeSlots: ComputeSlots = () => notImplemented('computeSlots');
export const checkWindow: CheckWindow = () => notImplemented('checkWindow');
export const findAlternatives: FindAlternatives = () => notImplemented('findAlternatives');
export const evaluateSameDay: EvaluateSameDay = () => notImplemented('evaluateSameDay');
export const sameDayQuotaCap: SameDayQuotaCap = () => notImplemented('sameDayQuotaCap');
