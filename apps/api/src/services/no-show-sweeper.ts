// SPEC §6.3 no-show sweeper: releases same-day appointments not checked in within the dealership's grace period.
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { Db } from '../db/client.js';
import { appointments, dealerships } from '../db/schema.js';
import { markLateNoShow } from './check-in.js';
import { getTelemetry } from '../observability/telemetry.js';

export interface SweeperLog {
  info: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

export async function releaseLateSameDay(
  db: Db,
  clock: Clock,
  log?: SweeperLog,
): Promise<{ released: string[] }> {
  const now = clock.now();
  const candidates = await db
    .select({
      reference: appointments.reference,
      id: appointments.id,
      dealershipId: appointments.dealershipId,
      bookingSessionId: appointments.bookingSessionId,
      graceMin: dealerships.lateGraceMin,
    })
    .from(appointments)
    .innerJoin(dealerships, eq(dealerships.id, appointments.dealershipId))
    .where(
      and(
        eq(appointments.status, 'CONFIRMED'),
        eq(appointments.channel, 'SAME_DAY'),
        isNull(appointments.checkedInAt),
        sql`${now.toISOString()}::timestamptz > ${appointments.startAt} + make_interval(mins => ${dealerships.lateGraceMin})`,
      ),
    );

  const released: string[] = [];
  for (const c of candidates) {
    // Each row in its own guarded transaction: a concurrent check-in/cancel simply makes the guarded UPDATE match nothing.
    const won = await db.transaction((tx) => markLateNoShow(tx, c, c.graceMin, now));
    if (won) released.push(c.reference);
  }
  if (released.length > 0) getTelemetry().noShowReleased(released.length);
  if (released.length > 0)
    log?.info({ released }, `no-show sweeper released ${released.length} appointment(s)`);
  return { released };
}

export function startNoShowSweeper(opts: {
  db: Db;
  clock: Clock;
  log?: SweeperLog;
  intervalMs?: number;
}): () => void {
  const { db, clock, log, intervalMs = 60_000 } = opts;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    releaseLateSameDay(db, clock, log)
      .catch((err: unknown) => log?.error({ err }, 'no-show sweeper failed'))
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
