// Read side of appointments: detail (with linked entities, parts and history) and the customer list.
import type { AppointmentDetail, AppointmentSummary } from '@scheduler/contracts';
import { and, asc, eq, isNull, lt, type SQL } from 'drizzle-orm';
import type { Clock } from '../clock.js';
import type { DbOrTx } from '../db/client.js';
import {
  appointmentParts,
  appointments,
  bookingEvents,
  customers,
  dealerships,
  parts,
  serviceBays,
  serviceTypes,
  technicians,
  vehicles,
} from '../db/schema.js';
import { notFound } from '../domain/errors.js';
import { formatLocalTime, localDateOf, localMinutesOf, toOffsetIso } from '../domain/time.js';
import { toHistoryEntry, type EventRow } from './history.js';

const timing = (startAt: Date, endAt: Date, tz: string) => ({
  startAt: toOffsetIso(startAt, tz),
  endAt: toOffsetIso(endAt, tz),
  localDate: localDateOf(startAt, tz),
  startTime: formatLocalTime(localMinutesOf(startAt, tz)),
  endTime: formatLocalTime(localMinutesOf(endAt, tz)),
});

/** Loads one appointment (by reference or id) as `AppointmentDetail`; null when it does not exist. */
export async function loadAppointmentDetail(
  db: DbOrTx,
  by: { reference: string } | { id: string },
): Promise<AppointmentDetail | null> {
  const where: SQL = 'reference' in by ? eq(appointments.reference, by.reference) : eq(appointments.id, by.id);
  const [row] = await db
    .select({
      a: appointments,
      customer: customers,
      vehicle: vehicles,
      dealership: dealerships,
      service: serviceTypes,
      tech: technicians,
      bay: serviceBays,
    })
    .from(appointments)
    .innerJoin(customers, eq(customers.id, appointments.customerId))
    .innerJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .innerJoin(dealerships, eq(dealerships.id, appointments.dealershipId))
    .innerJoin(serviceTypes, eq(serviceTypes.code, appointments.serviceTypeCode))
    .innerJoin(technicians, eq(technicians.id, appointments.technicianId))
    .innerJoin(serviceBays, eq(serviceBays.id, appointments.serviceBayId))
    .where(where);
  if (!row) return null;
  const { a, dealership: d } = row;
  const tz = d.timezone;

  const partLines = await db
    .select({ sku: appointmentParts.sku, name: parts.name, qty: appointmentParts.qty })
    .from(appointmentParts)
    .innerJoin(parts, eq(parts.sku, appointmentParts.sku))
    .where(eq(appointmentParts.appointmentId, a.id))
    .orderBy(asc(appointmentParts.sku));

  const asEvent = (e: typeof bookingEvents.$inferSelect): EventRow => ({
    id: e.id,
    type: e.type,
    detail: (e.detail ?? {}) as Record<string, unknown>,
    occurredAt: e.occurredAt,
  });
  const own = (await db.select().from(bookingEvents).where(eq(bookingEvents.appointmentId, a.id))).map(asEvent);

  // The session's pre-creation events (the failed attempt, the request) have no appointment_id yet.
  let earlier: EventRow[] = [];
  const createdId = own.find((e) => e.type === 'APPOINTMENT_CREATED')?.id ?? Math.min(...own.map((e) => e.id));
  if (a.bookingSessionId && Number.isFinite(createdId)) {
    earlier = (
      await db
        .select()
        .from(bookingEvents)
        .where(
          and(
            eq(bookingEvents.sessionId, a.bookingSessionId),
            isNull(bookingEvents.appointmentId),
            lt(bookingEvents.id, createdId),
          ),
        )
    ).map(asEvent);
  }
  const ctx = { timezone: tz, lateGraceMin: d.lateGraceMin };
  const ordered = [...earlier, ...own].sort((x, y) => x.occurredAt.getTime() - y.occurredAt.getTime() || x.id - y.id);
  const firstRequest = ordered.find((e) => e.type === 'SLOT_REQUESTED');
  const firstDate = typeof firstRequest?.detail.date === 'string' ? firstRequest.detail.date : '';
  const history = ordered.map((e) =>
    toHistoryEntry(e, e.type === 'SLOT_REQUESTED' && e !== firstRequest ? { ...ctx, laterRequestOf: { firstDate } } : ctx),
  );

  return {
    reference: a.reference,
    status: a.status,
    channel: a.channel,
    ...timing(a.startAt, a.endAt, tz),
    durationMin: a.durationMin,
    createdAt: toOffsetIso(a.createdAt, tz),
    checkedInAt: a.checkedInAt ? toOffsetIso(a.checkedInAt, tz) : null,
    cancelledAt: a.cancelledAt ? toOffsetIso(a.cancelledAt, tz) : null,
    lateGraceMin: d.lateGraceMin,
    customer: {
      id: row.customer.id,
      fullName: row.customer.fullName,
      phone: row.customer.phone,
      email: row.customer.email,
    },
    vehicle: {
      id: row.vehicle.id,
      customerId: row.vehicle.customerId,
      modelYear: row.vehicle.modelYear,
      modelName: row.vehicle.modelName,
      powertrain: row.vehicle.powertrain,
      vinLast4: row.vehicle.vin.trim().slice(-4),
      plate: row.vehicle.plate,
    },
    dealership: { id: d.id, name: d.name, timezone: tz },
    serviceType: {
      code: row.service.code,
      name: row.service.name,
      requiredSkill: row.service.requiredSkill,
      isExpress: row.service.isExpress,
    },
    technician: { id: row.tech.id, name: row.tech.name, skills: row.tech.skills },
    serviceBay: { id: row.bay.id, name: row.bay.name, bayType: row.bay.bayType },
    parts: partLines,
    history,
  };
}

export async function getAppointmentDetail(db: DbOrTx, reference: string): Promise<AppointmentDetail> {
  const detail = await loadAppointmentDetail(db, { reference });
  if (!detail) throw notFound('Appointment', reference);
  return detail;
}

/** Upcoming (start >= now) ascending, then past descending. */
export async function listAppointments(
  db: DbOrTx,
  clock: Clock,
  query: { customerId: string; status?: AppointmentSummary['status'] },
): Promise<AppointmentSummary[]> {
  const conds = [eq(appointments.customerId, query.customerId)];
  if (query.status) conds.push(eq(appointments.status, query.status));
  const rows = await db
    .select({ a: appointments, d: dealerships, s: serviceTypes, v: vehicles })
    .from(appointments)
    .innerJoin(dealerships, eq(dealerships.id, appointments.dealershipId))
    .innerJoin(serviceTypes, eq(serviceTypes.code, appointments.serviceTypeCode))
    .innerJoin(vehicles, eq(vehicles.id, appointments.vehicleId))
    .where(and(...conds));

  const now = clock.now().getTime();
  const byStart = (x: (typeof rows)[number], y: (typeof rows)[number]) =>
    x.a.startAt.getTime() - y.a.startAt.getTime() || x.a.reference.localeCompare(y.a.reference);
  const upcoming = rows.filter((r) => r.a.startAt.getTime() >= now).sort(byStart);
  const past = rows.filter((r) => r.a.startAt.getTime() < now).sort((x, y) => byStart(y, x));

  return [...upcoming, ...past].map(({ a, d, s, v }) => ({
    reference: a.reference,
    status: a.status,
    channel: a.channel,
    ...timing(a.startAt, a.endAt, d.timezone),
    durationMin: a.durationMin,
    dealership: { id: d.id, name: d.name },
    serviceType: { code: s.code, name: s.name },
    vehicle: { id: v.id, modelYear: v.modelYear, modelName: v.modelName, plate: v.plate },
  }));
}
