import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { BookingAttempt } from './telemetry.js';

const BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

export interface Metrics {
  registry: Registry;
  httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  bookingAttempts: Counter<'outcome' | 'reason' | 'channel'>;
  reserveDuration: Histogram;
  lockWait: Histogram;
  availabilityDuration: Histogram<'same_day'>;
  noShowReleased: Counter;
}

/** One registry per app instance, so tests can build many apps without duplicate-registration errors. */
export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });
  const registers = [registry];
  return {
    registry,
    httpDuration: new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration by method, route pattern and status code',
      labelNames: ['method', 'route', 'status_code'],
      buckets: BUCKETS,
      registers,
    }),
    bookingAttempts: new Counter({
      name: 'booking_attempts_total',
      help: 'Booking attempts by outcome (created|replayed|rejected|invalid), reason and channel',
      labelNames: ['outcome', 'reason', 'channel'],
      registers,
    }),
    reserveDuration: new Histogram({
      name: 'booking_reserve_duration_seconds',
      help: 'Booking transaction wall time including advisory lock wait',
      buckets: BUCKETS,
      registers,
    }),
    lockWait: new Histogram({
      name: 'booking_lock_wait_seconds',
      help: 'Time to acquire the per-(dealership, day) advisory lock',
      buckets: BUCKETS,
      registers,
    }),
    availabilityDuration: new Histogram({
      name: 'availability_compute_duration_seconds',
      help: 'Availability computation duration',
      labelNames: ['same_day'],
      buckets: BUCKETS,
      registers,
    }),
    noShowReleased: new Counter({
      name: 'no_show_released_total',
      help: 'Appointments released by the no-show sweeper',
      registers,
    }),
  };
}

export const bookingLabels = (a: BookingAttempt) => ({ outcome: a.outcome, reason: a.reason, channel: a.channel });
