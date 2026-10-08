// Background load (SPEC §7): ~30% bay utilisation, technicians capped at 50%, of ADVANCE/CONFIRMED appointments for background customers
// for today + the next 10 working days, generated THROUGH the availability engine so every row is valid.
import { sql } from 'drizzle-orm';
import type { Clock } from '../../clock.js';
import * as realEngine from '../../domain/availability/index.js';
import type { ComputeSlots, ServiceSpec } from '../../domain/availability/types.js';
import { formatLocalTime, localToday, nextWorkingDays, toInstant, isWorkingDay } from '../../domain/time.js';
import type { DbOrTx } from '../client.js';
import { loadDayContext } from '../repositories/day-context.js';
import { listDealerships, listServiceTypes, listVehiclesByCustomer, type VehicleRow } from '../repositories/reference.js';
import { listBays } from '../repositories/reference.js';
import { appointments, bookingEvents, customers } from '../schema.js';
import { pick, type Rng } from './prng.js';

export interface SeedEngine {
  computeSlots: ComputeSlots;
}

export interface BackgroundLoadDeps {
  clock: Clock;
  rng: Rng;
  /** Defaults to the real availability engine; inject a fake in tests. */
  engine?: SeedEngine;
}

// ~30% of bay-minutes overall, and no technician above half a day, so specialist services (brakes, alignment) still
// have open slots for the demo. A flat 50% bay target saturated the two Brakes technicians (found in the W3 smoke test).
const TARGET_UTILISATION = 0.3;
const MAX_TECHNICIAN_SHARE = 0.5;
const MAX_ATTEMPTS_PER_DAY = 60;
const DAYS_AHEAD = 10;

/** Returns the number of appointments inserted. */
export const seedBackgroundLoad = async (db: DbOrTx, deps: BackgroundLoadDeps): Promise<number> => {
  const { clock, rng } = deps;
  const engine: SeedEngine = deps.engine ?? { computeSlots: realEngine.computeSlots };
  const now = clock.now();

  const dealerships = await listDealerships(db);
  const services = await listServiceTypes(db);
  const bgCustomers = (await db.select({ id: customers.id }).from(customers).orderBy(customers.id)).filter(
    (c) => c.id !== 'CUS-10482',
  );
  const vehicles: VehicleRow[] = [];
  for (const c of bgCustomers) vehicles.push(...(await listVehiclesByCustomer(db, c.id)));

  // Vehicle busy windows across all dealerships (a vehicle cannot be in two places at once — SPEC A8).
  const vehicleBusy = new Map<string, { start: number; end: number }[]>();
  let inserted = 0;

  for (const dealership of dealerships) {
    const tz = dealership.timezone;
    const today = localToday(clock, tz);
    const days = [today, ...nextWorkingDays(today, DAYS_AHEAD, dealership.workingDays)].filter((d) =>
      isWorkingDay(d, dealership.workingDays),
    );
    const bays = await listBays(db, dealership.id);

    for (const date of days) {
      const probe = await loadDayContext(db, dealership, date, { sameDay: null });
      const targetMin = Math.round(bays.length * (probe.closesAt - probe.opensAt) * TARGET_UTILISATION);
      let busyMin = 0;

      for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_DAY && busyMin < targetMin; attempt++) {
        const vehicle = pick(rng, vehicles);
        const applicable = services.filter((s) => s.powertrains.includes(vehicle.powertrain));
        const service = pick(rng, applicable);
        const spec: ServiceSpec = {
          code: service.code,
          durationMin: service.durationMin,
          requiredSkill: service.requiredSkill,
          allowedBayTypes: service.allowedBayTypes,
        };

        const day = await loadDayContext(db, dealership, date, { sameDay: null });
        const candidates = engine
          .computeSlots(day, spec)
          .filter((s) => s.status === 'AVAILABLE' && s.proposed !== null)
          .filter((s) => {
            const tech = day.technicians.find((t) => t.id === s.proposed!.technicianId);
            const techBusy = (tech?.busy ?? []).reduce((sum, b) => sum + (b.end - b.start), 0);
            return techBusy + service.durationMin <= (day.closesAt - day.opensAt) * MAX_TECHNICIAN_SHARE;
          })
          .filter((s) => toInstant(date, s.start, tz).getTime() > now.getTime())
          .filter((s) => {
            const startMs = toInstant(date, s.start, tz).getTime();
            const endMs = startMs + service.durationMin * 60_000;
            return !(vehicleBusy.get(vehicle.id) ?? []).some((b) => b.start < endMs && startMs < b.end);
          });
        if (candidates.length === 0) continue;

        const slot = pick(rng, candidates);
        const proposed = slot.proposed!;
        const startAt = toInstant(date, slot.start, tz);
        const endAt = new Date(startAt.getTime() + service.durationMin * 60_000);

        const seqRes = await db.execute<{ n: string }>(sql`select nextval('appointment_ref_seq') as n`);
        const seq = Number(seqRes.rows[0]!.n);
        const reference = `APT-${date.replaceAll('-', '')}-${String(seq % 10000).padStart(4, '0')}`;

        const [row] = await db
          .insert(appointments)
          .values({
            reference,
            status: 'CONFIRMED',
            channel: 'ADVANCE',
            customerId: vehicle.customerId,
            vehicleId: vehicle.id,
            dealershipId: dealership.id,
            serviceTypeCode: service.code,
            technicianId: proposed.technicianId,
            serviceBayId: proposed.bayId,
            startAt,
            endAt,
            durationMin: service.durationMin,
            createdAt: now,
          })
          .returning({ id: appointments.id });
        await db.insert(bookingEvents).values({
          appointmentId: row!.id,
          type: 'APPOINTMENT_CREATED',
          detail: { seeded: true, localStart: `${date} ${formatLocalTime(slot.start)}` },
          occurredAt: now,
        });

        const list = vehicleBusy.get(vehicle.id) ?? [];
        list.push({ start: startAt.getTime(), end: endAt.getTime() });
        vehicleBusy.set(vehicle.id, list);
        busyMin += service.durationMin;
        inserted++;
      }
    }
  }
  return inserted;
};
