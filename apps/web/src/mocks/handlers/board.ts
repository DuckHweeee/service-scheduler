import type { BoardBlock, BoardResponse } from '@scheduler/contracts';
import { BoardQuery, routes } from '@scheduler/contracts';
import { HttpResponse, http } from 'msw';
import { apiUrl } from '../../config.js';
import { fmtMin, isoWeekday, toOffsetIso, zonedToMs } from '../../lib/time.js';
import { getDealership, getServiceType, store } from '../store.js';
import type { MockAppointment } from '../store.js';
import { notFound, problem } from '../support.js';

export const boardHandlers = [
  http.get(apiUrl(routes.board), ({ params, request }) => {
    const d = getDealership(String(params.id));
    if (!d) return notFound('Dealership');
    const parsed = BoardQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) {
      return problem(400, 'VALIDATION_ERROR', 'A valid date (YYYY-MM-DD) is required.', {
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const { date } = parsed.data;
    const tz = d.timezone;
    const day = store.appointments.filter(
      (a) => a.dealershipId === d.id && a.date === date && a.status !== 'CANCELLED',
    );

    const blockOf = (a: MockAppointment): BoardBlock => ({
      reference: a.reference,
      status: a.status === 'NO_SHOW' ? 'NO_SHOW' : 'CONFIRMED',
      channel: a.channel,
      serviceTypeCode: a.serviceTypeCode,
      serviceTypeName: getServiceType(a.serviceTypeCode)!.name,
      startTime: fmtMin(a.startMin),
      endTime: fmtMin(a.endMin),
      startAt: toOffsetIso(zonedToMs(date, a.startMin, tz), tz),
      endAt: toOffsetIso(zonedToMs(date, a.endMin, tz), tz),
      checkedInAt: a.checkedInAtMs === null ? null : toOffsetIso(a.checkedInAtMs, tz),
    });
    const blocksFor = (match: (a: MockAppointment) => boolean) =>
      day
        .filter(match)
        .sort((a, b) => a.startMin - b.startMin)
        .map(blockOf);

    const body: BoardResponse = {
      dealership: { id: d.id, name: d.name, timezone: tz },
      date,
      isWorkingDay: d.workingDays.includes(isoWeekday(date)),
      opensAt: d.opensAt,
      closesAt: d.closesAt,
      bays: store.bays[d.id]!.map((b) => ({ ...b, blocks: blocksFor((a) => a.bayId === b.id) })),
      technicians: store.techs[d.id]!.map((t) => ({
        ...t,
        blocks: blocksFor((a) => a.technicianId === t.id),
      })),
    };
    return HttpResponse.json(body);
  }),
];
