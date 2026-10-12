import type { AvailabilityResponse, AvailabilitySlot } from '@scheduler/contracts';
import { AvailabilityQuery, routes } from '@scheduler/contracts';
import { HttpResponse, http } from 'msw';
import { apiUrl } from '../../config.js';
import { addDays, daysBetween, fmtMin, toOffsetIso, zonedToMs } from '../../lib/time.js';
import { computeSlots } from '../engine.js';
import { resolveDay } from '../resolve.js';
import { getDealership, getServiceType, getVehicle } from '../store.js';
import { notFound, problem, specOf } from '../support.js';

export const HORIZON_DAYS = 30;

export const availabilityHandlers = [
  http.get(apiUrl(routes.availability), ({ params, request }) => {
    const dealership = getDealership(String(params.id));
    if (!dealership) return notFound('Dealership');

    const url = new URL(request.url);
    const parsed = AvailabilityQuery.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) {
      return problem(400, 'VALIDATION_ERROR', 'Invalid query parameters.', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const q = parsed.data;
    const service = getServiceType(q.serviceType);
    if (!service) return notFound('Service type');
    const vehicle = getVehicle(q.vehicleId);
    if (!vehicle) return notFound('Vehicle');

    const tz = dealership.timezone;
    const resolved = resolveDay(dealership.id, q.date, service, vehicle.modelName, q.excludeReference);
    const offset = daysBetween(resolved.now.date, q.date);
    if (offset < 0 || offset > HORIZON_DAYS) {
      return problem(
        422,
        'OUTSIDE_BOOKING_HORIZON',
        `Bookings are open from ${resolved.now.date} to ${addDays(resolved.now.date, HORIZON_DAYS)}.`,
      );
    }
    if (!service.powertrains.includes(vehicle.powertrain)) {
      return problem(
        422,
        'SERVICE_NOT_APPLICABLE',
        `${service.name} does not apply to ${vehicle.powertrain} vehicles.`,
      );
    }

    const slots: AvailabilitySlot[] = resolved.blocked
      ? []
      : computeSlots(resolved.day, specOf(service)).map((s) => ({
          startTime: fmtMin(s.start),
          endTime: fmtMin(s.end),
          startAt: toOffsetIso(zonedToMs(q.date, s.start, tz), tz),
          status: s.status,
          isExpress: resolved.sameDay !== null,
          proposed: s.proposed
            ? {
                serviceBay: {
                  id: s.proposed.bay.id,
                  name: s.proposed.bay.name,
                  bayType: s.proposed.bay.bayType,
                },
                technician: { id: s.proposed.technician.id, name: s.proposed.technician.name },
              }
            : null,
        }));

    const body: AvailabilityResponse = {
      dealershipId: dealership.id,
      serviceTypeCode: service.code,
      date: q.date,
      timezone: tz,
      isWorkingDay: resolved.day.isWorkingDay,
      durationMin: service.durationMin,
      sameDay: resolved.sameDay,
      slots,
    };
    return HttpResponse.json(body);
  }),
];
