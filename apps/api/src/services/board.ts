// A3: service board read model (SPEC §6, S3). CONFIRMED and NO_SHOW appointments of one dealership-local date.
import type { BoardBlock, BoardResponse } from '@scheduler/contracts';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { DbOrTx } from '../db/client.js';
import { getDealership, listBays, listTechnicians } from '../db/repositories/index.js';
import { appointments, serviceTypes } from '../db/schema.js';
import { notFound } from '../domain/errors.js';
import { addLocalDays, formatLocalTime, isWorkingDay, localMinutesOf, toInstant, toOffsetIso } from '../domain/time.js';

export async function getBoard(db: DbOrTx, dealershipId: string, date: string): Promise<BoardResponse> {
  const dealership = await getDealership(db, dealershipId);
  if (!dealership) throw notFound('Dealership', dealershipId);
  const tz = dealership.timezone;
  const from = toInstant(date, 0, tz);
  const to = toInstant(addLocalDays(date, 1), 0, tz);

  const [bays, techs, rows] = await Promise.all([
    listBays(db, dealershipId),
    listTechnicians(db, dealershipId),
    db
      .select({
        reference: appointments.reference,
        status: appointments.status,
        channel: appointments.channel,
        serviceTypeCode: appointments.serviceTypeCode,
        serviceTypeName: serviceTypes.name,
        bayId: appointments.serviceBayId,
        technicianId: appointments.technicianId,
        startAt: appointments.startAt,
        endAt: appointments.endAt,
        checkedInAt: appointments.checkedInAt,
      })
      .from(appointments)
      .innerJoin(serviceTypes, eq(serviceTypes.code, appointments.serviceTypeCode))
      .where(
        and(
          eq(appointments.dealershipId, dealershipId),
          inArray(appointments.status, ['CONFIRMED', 'NO_SHOW']),
          gte(appointments.startAt, from),
          lt(appointments.startAt, to),
        ),
      )
      .orderBy(asc(appointments.startAt), asc(appointments.reference)),
  ]);

  const bayBlocks = new Map<string, BoardBlock[]>();
  const techBlocks = new Map<string, BoardBlock[]>();
  const push = (m: Map<string, BoardBlock[]>, key: string, b: BoardBlock) => {
    const list = m.get(key);
    if (list) list.push(b);
    else m.set(key, [b]);
  };
  for (const r of rows) {
    if (r.status === 'CANCELLED') continue;
    const block: BoardBlock = {
      reference: r.reference,
      status: r.status,
      channel: r.channel,
      serviceTypeCode: r.serviceTypeCode,
      serviceTypeName: r.serviceTypeName,
      startTime: formatLocalTime(localMinutesOf(r.startAt, tz)),
      endTime: formatLocalTime(localMinutesOf(r.endAt, tz)),
      startAt: toOffsetIso(r.startAt, tz),
      endAt: toOffsetIso(r.endAt, tz),
      checkedInAt: r.checkedInAt ? toOffsetIso(r.checkedInAt, tz) : null,
    };
    push(bayBlocks, r.bayId, block);
    push(techBlocks, r.technicianId, block);
  }

  return {
    dealership: { id: dealership.id, name: dealership.name, timezone: tz },
    date,
    isWorkingDay: isWorkingDay(date, dealership.workingDays),
    opensAt: dealership.opensAt,
    closesAt: dealership.closesAt,
    bays: bays.map((b) => ({ id: b.id, name: b.name, bayType: b.bayType, blocks: bayBlocks.get(b.id) ?? [] })),
    technicians: techs.map((t) => ({ id: t.id, name: t.name, skills: t.skills, blocks: techBlocks.get(t.id) ?? [] })),
  };
}
