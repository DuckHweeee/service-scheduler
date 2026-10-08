import type { AppointmentList, HistoryEntry } from '@scheduler/contracts';
import {
  AppointmentStatus,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  IDEMPOTENCY_HEADER,
  routes,
} from '@scheduler/contracts';
import { HttpResponse, http } from 'msw';
import { apiUrl } from '../../config.js';
import { addDays, daysBetween, fmtMin, parseMin, toOffsetIso, zonedToMs } from '../../lib/time.js';
import { checkWindow } from '../engine.js';
import { resolveDay } from '../resolve.js';
import { hasScenario, mockNow } from '../scenario.js';
import { getCustomer, getDealership, getServiceType, getVehicle, partRequirements, store } from '../store.js';
import type { MockAppointment } from '../store.js';
import {
  SKILL_WORD,
  alternativesFor,
  notFound,
  problem,
  slotConflictDetail,
  specOf,
  toDetail,
  toSummary,
} from '../support.js';
import { HORIZON_DAYS } from './availability.js';

const event = (
  type: HistoryEntry['type'],
  ms: number,
  tz: string,
  summary: string,
  detail: HistoryEntry['detail'] = {},
): HistoryEntry => ({
  type,
  occurredAt: toOffsetIso(ms, tz),
  summary,
  detail,
});

function releaseParts(a: MockAppointment) {
  for (const p of a.parts) {
    if (p.released) continue;
    const line = store.inventory[a.dealershipId]?.[p.sku];
    if (line) line.reserved = Math.max(0, line.reserved - p.qty);
    p.released = true;
  }
}

export const appointmentHandlers = [
  http.post(apiUrl(routes.appointments), async ({ request }) => {
    const raw: unknown = await request.json().catch(() => undefined);
    const parsed = CreateAppointmentRequest.safeParse(raw);
    if (!parsed.success) {
      return problem(400, 'VALIDATION_ERROR', 'The request body is invalid.', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const body = parsed.data;

    const idemKey = request.headers.get(IDEMPOTENCY_HEADER);
    if (idemKey && store.idempotency.has(idemKey)) {
      const existing = store.appointments.find((a) => a.reference === store.idempotency.get(idemKey));
      if (existing) return HttpResponse.json(toDetail(existing), { status: 200 });
    }

    const customer = getCustomer(body.customerId);
    const vehicle = getVehicle(body.vehicleId);
    const dealership = getDealership(body.dealershipId);
    const service = getServiceType(body.serviceTypeCode);
    if (!customer) return notFound('Customer');
    if (!vehicle) return notFound('Vehicle');
    if (!dealership) return notFound('Dealership');
    if (!service) return notFound('Service type');
    if (vehicle.customerId !== customer.id)
      return problem(422, 'VEHICLE_NOT_OWNED', 'That vehicle does not belong to this customer.');
    if (!service.powertrains.includes(vehicle.powertrain)) {
      return problem(
        422,
        'SERVICE_NOT_APPLICABLE',
        `${service.name} does not apply to ${vehicle.powertrain} vehicles.`,
      );
    }

    const tz = dealership.timezone;
    const resolved = resolveDay(dealership.id, body.date, service, vehicle.modelName);
    const today = resolved.now.date;
    const horizonEnd = addDays(today, HORIZON_DAYS);
    const offset = daysBetween(today, body.date);
    if (offset < 0 || offset > HORIZON_DAYS) {
      return problem(422, 'OUTSIDE_BOOKING_HORIZON', `Bookings are open from ${today} to ${horizonEnd}.`);
    }

    const start = parseMin(body.startTime);
    const end = start + service.durationMin;
    const opensAt = parseMin(dealership.opensAt);
    const closesAt = parseMin(dealership.closesAt);
    if (!resolved.day.isWorkingDay || start < opensAt || end > closesAt) {
      return problem(
        422,
        'OUTSIDE_OPENING_HOURS',
        `The job must start and finish within opening hours (${dealership.opensAt}–${dealership.closesAt}, Monday to Friday).`,
      );
    }
    if ((start - opensAt) % 30 !== 0)
      return problem(422, 'MISALIGNED_START', 'Start times fall on 30-minute marks from opening.');

    const isSameDay = body.date === today;
    if (isSameDay) {
      if (resolved.blocked === 'SERVICE_NOT_EXPRESS')
        return problem(422, 'SERVICE_NOT_EXPRESS', `${service.name} cannot be booked for today.`);
      if (resolved.blocked === 'PARTS_UNAVAILABLE')
        return problem(
          409,
          'PARTS_UNAVAILABLE',
          `Parts for ${service.name} are not in stock at ${dealership.name} today.`,
        );
      if (
        resolved.blocked === 'PAST_CUTOFF' ||
        (resolved.earliestStart !== null && start < resolved.earliestStart)
      ) {
        return problem(
          422,
          'LEAD_TIME_NOT_MET',
          `Same-day bookings need ${dealership.sameDayPolicy.leadTimeMin / 60} hours' notice.`,
        );
      }
    }

    const sameDayFor = (_base: unknown, date: string) =>
      resolveDay(dealership.id, date, service, vehicle.modelName).day;
    const conflict = (status: Parameters<typeof slotConflictDetail>[0]) =>
      problem(
        409,
        'SLOT_UNAVAILABLE',
        slotConflictDetail(status, SKILL_WORD[service.requiredSkill] ?? service.requiredSkill, start, end),
        {
          reason: status,
          alternatives: alternativesFor(
            dealership.id,
            service,
            body.date,
            start,
            today,
            horizonEnd,
            sameDayFor,
          ),
        },
      );

    if (hasScenario('conflict') && !store.conflictConsumed) {
      store.conflictConsumed = true;
      return conflict('NO_QUALIFIED_TECHNICIAN');
    }

    // A8: the vehicle cannot have two overlapping confirmed appointments.
    const vehicleClash = store.appointments.some(
      (a) =>
        a.status === 'CONFIRMED' &&
        a.vehicleId === vehicle.id &&
        a.date === body.date &&
        a.startMin < end &&
        start < a.endMin,
    );
    if (vehicleClash)
      return problem(
        409,
        'VEHICLE_ALREADY_BOOKED',
        'This vehicle already has a confirmed appointment that overlaps this time.',
      );

    const window = checkWindow(resolved.day, specOf(service), start);
    if (window.status !== 'AVAILABLE' || !window.proposed) return conflict(window.status);

    const parts = isSameDay ? partRequirements(service.code, vehicle.modelName) : [];
    for (const p of parts) {
      const line = store.inventory[dealership.id]?.[p.sku];
      if (!line || line.onHand - line.reserved < p.qty) {
        return problem(
          409,
          'PARTS_UNAVAILABLE',
          `Parts for ${service.name} are not in stock at ${dealership.name} today.`,
        );
      }
    }
    for (const p of parts) store.inventory[dealership.id]![p.sku]!.reserved += p.qty;

    const nowMs = resolved.now.ms;
    const ref = `APT-${body.date.replaceAll('-', '')}-${String(store.nextRef++ % 10000).padStart(4, '0')}`;
    const { bay, technician } = window.proposed;
    const range = `${fmtMin(start)}–${fmtMin(end)}`;
    const appointment: MockAppointment = {
      reference: ref,
      status: 'CONFIRMED',
      channel: isSameDay ? 'SAME_DAY' : 'ADVANCE',
      customerId: customer.id,
      vehicleId: vehicle.id,
      dealershipId: dealership.id,
      serviceTypeCode: service.code,
      technicianId: technician.id,
      bayId: bay.id,
      date: body.date,
      startMin: start,
      endMin: end,
      createdAtMs: nowMs,
      checkedInAtMs: null,
      cancelledAtMs: null,
      bookingSessionId: body.bookingSessionId,
      parts: parts.map((p) => ({ ...p, released: false })),
      history: [
        event('SLOT_REQUESTED', nowMs, tz, `Requested ${range}`, { startTime: body.startTime }),
        event('CHECK_PASSED', nowMs, tz, `Check passed: ${bay.name} and ${technician.name} free ${range}`, {
          bayId: bay.id,
          technicianId: technician.id,
        }),
        event('RESOURCES_RESERVED', nowMs, tz, 'Bay and technician reserved together'),
        event('APPOINTMENT_CREATED', nowMs, tz, 'Appointment record created · confirmation sent'),
      ],
    };
    store.appointments.push(appointment);
    if (idemKey) store.idempotency.set(idemKey, ref);
    return HttpResponse.json(toDetail(appointment), { status: 201 });
  }),

  http.get(apiUrl(routes.appointments), ({ request }) => {
    const url = new URL(request.url);
    const customerId = url.searchParams.get('customerId');
    if (!customerId)
      return problem(400, 'VALIDATION_ERROR', 'customerId is required.', {
        errors: [{ path: 'customerId', message: 'Required' }],
      });
    const statusParam = url.searchParams.get('status');
    const status = statusParam ? AppointmentStatus.safeParse(statusParam) : null;
    if (status && !status.success)
      return problem(400, 'VALIDATION_ERROR', 'Unknown status.', {
        errors: [{ path: 'status', message: 'Invalid value' }],
      });
    const items = store.appointments
      .filter((a) => a.customerId === customerId && (!status || a.status === status.data))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin)
      .map(toSummary);
    return HttpResponse.json({ items } satisfies AppointmentList);
  }),

  http.get(apiUrl(routes.appointment), ({ params }) => {
    const a = store.appointments.find((x) => x.reference === params.reference);
    return a ? HttpResponse.json(toDetail(a)) : notFound('Appointment');
  }),

  http.post(apiUrl(routes.cancelAppointment), async ({ params, request }) => {
    const a = store.appointments.find((x) => x.reference === params.reference);
    if (!a) return notFound('Appointment');
    const raw: unknown = await request.json().catch(() => ({}));
    const body = CancelAppointmentRequest.safeParse(raw ?? {});
    if (a.status === 'CANCELLED') return HttpResponse.json(toDetail(a));

    const tz = getDealership(a.dealershipId)!.timezone;
    const now = mockNow(tz);
    const startsInFuture = zonedToMs(a.date, a.startMin, tz) > now.ms;
    if (a.status !== 'CONFIRMED' || !startsInFuture) {
      return problem(
        409,
        'APPOINTMENT_NOT_CANCELLABLE',
        'Only upcoming confirmed appointments can be cancelled.',
      );
    }
    a.status = 'CANCELLED';
    a.cancelledAtMs = now.ms;
    releaseParts(a);
    a.history.push(
      event(
        'APPOINTMENT_CANCELLED',
        now.ms,
        tz,
        'Appointment cancelled',
        body.success && body.data.reason ? { reason: body.data.reason } : {},
      ),
    );
    return HttpResponse.json(toDetail(a));
  }),

  http.post(apiUrl(routes.checkIn), ({ params }) => {
    const a = store.appointments.find((x) => x.reference === params.reference);
    if (!a) return notFound('Appointment');
    if (a.status !== 'CONFIRMED' || a.checkedInAtMs !== null) {
      return problem(
        409,
        'APPOINTMENT_NOT_ACTIVE',
        'Only confirmed appointments that have not checked in can be checked in.',
      );
    }
    const d = getDealership(a.dealershipId)!;
    const now = mockNow(d.timezone);
    const startMs = zonedToMs(a.date, a.startMin, d.timezone);
    if (a.channel === 'SAME_DAY' && now.ms > startMs + d.sameDayPolicy.lateGraceMin * 60000) {
      a.status = 'NO_SHOW';
      releaseParts(a);
      a.history.push(
        event(
          'APPOINTMENT_NO_SHOW',
          now.ms,
          d.timezone,
          `Released as no-show: arrived more than ${d.sameDayPolicy.lateGraceMin} minutes late`,
        ),
      );
      return problem(
        409,
        'LATE_ARRIVAL',
        `Arrived more than ${d.sameDayPolicy.lateGraceMin} minutes late. The appointment was released.`,
      );
    }
    a.checkedInAtMs = now.ms;
    a.history.push(event('CHECKED_IN', now.ms, d.timezone, 'Customer checked in'));
    return HttpResponse.json(toDetail(a));
  }),
];
