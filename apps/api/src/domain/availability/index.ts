// Public surface of the availability engine (pure: no I/O, no Date).
export * from './types.js';
export { computeSlots, checkWindow } from './engine.js';
export { findAlternatives } from './alternatives.js';
export { evaluateSameDay, sameDayQuotaCap } from './same-day.js';
