import { and, eq, gte, lt, ne } from 'drizzle-orm';
import type { DayContext, Interval } from '../../domain/availability/types.js';
import { addLocalDays, localMinutesOf, parseLocalTime, toInstant, isWorkingDay } from '../../domain/time.js';
import type { DbOrTx } from '../client.js';
import { appointments } from '../schema.js';
import { listBays, listTechnicians, type DealershipRow } from './reference.js';

export interface LoadDayContextOptions {
  /** Pass for "today" (same-day channel); null for any other day. */
  sameDay: { earliestStart: number; quotaCap: number } | null;
  /** Reschedule (SPEC §6.5): treat this appointment as absent — its bay, technician and quota share count as free. */
  excludeAppointmentId?: string;
}

/**
 * Builds the engine input for one dealership-local date: CONFIRMED appointments only (cancelled/no-show free their
 * resources), as busy intervals in local minutes per bay and per technician. `sameDayBusy` is populated only from
 * `channel = 'SAME_DAY'` rows. Call it inside the booking transaction to see a consistent view.
 */
export const loadDayContext = async (
  db: DbOrTx,
  dealership: DealershipRow,
  localDate: string,
  opts: LoadDayContextOptions,
): Promise<DayContext> => {
  const tz = dealership.timezone;
  const from = toInstant(localDate, 0, tz);
  const to = toInstant(addLocalDays(localDate, 1), 0, tz);

  // Sequential on purpose: `db` may be a transaction (one connection); pg rejects overlapping queries on one client.
  const bays = await listBays(db, dealership.id);
  const techs = await listTechnicians(db, dealership.id);
  const rows = await db
    .select({
      bayId: appointments.serviceBayId,
      technicianId: appointments.technicianId,
      channel: appointments.channel,
      startAt: appointments.startAt,
      endAt: appointments.endAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.dealershipId, dealership.id),
        eq(appointments.status, 'CONFIRMED'),
        gte(appointments.startAt, from),
        lt(appointments.startAt, to),
        opts.excludeAppointmentId ? ne(appointments.id, opts.excludeAppointmentId) : undefined,
      ),
    );

  const busyByBay = new Map<string, Interval[]>();
  const busyByTech = new Map<string, Interval[]>();
  const sameDayBusy: Interval[] = [];
  const push = (m: Map<string, Interval[]>, key: string, iv: Interval) => {
    const list = m.get(key);
    if (list) list.push(iv);
    else m.set(key, [iv]);
  };

  for (const r of rows) {
    const start = localMinutesOf(r.startAt, tz);
    const end = start + Math.round((r.endAt.getTime() - r.startAt.getTime()) / 60_000);
    const iv = { start, end };
    push(busyByBay, r.bayId, iv);
    push(busyByTech, r.technicianId, iv);
    if (r.channel === 'SAME_DAY') sameDayBusy.push(iv);
  }
  const byStart = (a: Interval, b: Interval) => a.start - b.start || a.end - b.end;

  return {
    opensAt: parseLocalTime(dealership.opensAt),
    closesAt: parseLocalTime(dealership.closesAt),
    isWorkingDay: isWorkingDay(localDate, dealership.workingDays),
    bays: bays.map((b) => ({
      id: b.id,
      name: b.name,
      bayType: b.bayType,
      busy: (busyByBay.get(b.id) ?? []).sort(byStart),
    })),
    technicians: techs.map((t) => ({
      id: t.id,
      name: t.name,
      skills: t.skills,
      busy: (busyByTech.get(t.id) ?? []).sort(byStart),
    })),
    sameDay: opts.sameDay
      ? {
          earliestStart: opts.sameDay.earliestStart,
          quotaCap: opts.sameDay.quotaCap,
          sameDayBusy: sameDayBusy.sort(byStart),
        }
      : null,
  };
};
