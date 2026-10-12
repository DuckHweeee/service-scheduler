// Vendor-free observability interface. Services and plugins depend on this file only; prom-client and OpenTelemetry
// stay inside the sibling files (metrics.ts, tracing.ts, otel-telemetry.ts) and `src/instrumentation.ts`.

export type BookingOutcome = 'created' | 'replayed' | 'rejected' | 'invalid';

export interface BookingAttempt {
  outcome: BookingOutcome;
  /** Error code or slot status; `none` on success. */
  reason: string;
  /** `ADVANCE` | `SAME_DAY` | `unknown` (failed before the channel was known). */
  channel: string;
  /** Context for the outcome log line (never customer PII). */
  dealershipId?: string;
  serviceTypeCode?: string;
  durationMs?: number;
}

export type RescheduleOutcome = 'rescheduled' | 'unchanged' | 'rejected' | 'invalid';

export interface RescheduleAttempt {
  outcome: RescheduleOutcome;
  /** Error code or slot status; `none` on success. */
  reason: string;
  dealershipId?: string;
  serviceTypeCode?: string;
  durationMs?: number;
}

export type SpanAttributes = Record<string, string | number | boolean>;

export interface SpanHandle {
  setAttributes(attrs: SpanAttributes): void;
}

export interface Telemetry {
  bookingAttempt(a: BookingAttempt): void;
  rescheduleAttempt(a: RescheduleAttempt): void;
  /** Wall time of the booking transaction, lock wait included. */
  observeReserve(seconds: number): void;
  /** Time spent acquiring the per-(dealership, day) advisory lock. */
  observeLockWait(seconds: number): void;
  observeAvailability(seconds: number, sameDay: boolean): void;
  noShowReleased(count?: number): void;
  /** Runs `fn` inside an active span (passthrough when tracing is off). Errors are recorded and rethrown. */
  withSpan<T>(name: string, attrs: SpanAttributes, fn: (span: SpanHandle) => Promise<T>): Promise<T>;
}

const noopSpan: SpanHandle = { setAttributes: () => {} };

export const noopTelemetry: Telemetry = {
  bookingAttempt: () => {},
  rescheduleAttempt: () => {},
  observeReserve: () => {},
  observeLockWait: () => {},
  observeAvailability: () => {},
  noShowReleased: () => {},
  withSpan: (_name, _attrs, fn) => fn(noopSpan),
};

let current: Telemetry = noopTelemetry;

/** Services call this per operation; a no-op until `buildApp` installs the real implementation. */
export const getTelemetry = (): Telemetry => current;
export const setTelemetry = (t: Telemetry): void => {
  current = t;
};

/** Monotonic stopwatch in seconds. */
export const startTimer = (): (() => number) => {
  const t0 = process.hrtime.bigint();
  return () => Number(process.hrtime.bigint() - t0) / 1e9;
};
