// Server-rendered booking-history sentences (SPEC §6.4, design 03). Summaries are derived from the stored event
// `detail` so old events keep rendering the same way.
import type { HistoryEntry } from '@scheduler/contracts';
import { toOffsetIso } from '../domain/time.js';

export interface EventRow {
  id: number;
  type: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
}

export interface HistoryContext {
  timezone: string;
  lateGraceMin: number;
}

const NUMBER_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five'];

const SKILL_LABEL: Record<string, string> = {
  GENERAL: 'General',
  BRAKES: 'Brakes',
  ALIGNMENT: 'Alignment',
  EV_HIGH_VOLTAGE: 'EV high-voltage',
};

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);

const alternativesSentence = (count: unknown): string => {
  const n = typeof count === 'number' ? count : 0;
  if (n <= 0) return 'No alternatives available.';
  const word = NUMBER_WORDS[Math.min(n, 5)] ?? String(n);
  return `${word} ${n === 1 ? 'alternative' : 'alternatives'} offered.`;
};

const checkFailedReason = (detail: Record<string, unknown>): string => {
  switch (str(detail.reason)) {
    case 'NO_QUALIFIED_TECHNICIAN': {
      const skill = SKILL_LABEL[str(detail.skill)] ?? 'qualified';
      return `no ${skill}-qualified technician free for the full window.`;
    }
    case 'NO_BAY':
      return 'no suitable bay free for the full window.';
    case 'FULLY_BOOKED':
      return 'no bay or qualified technician free for the full window.';
    case 'SAME_DAY_QUOTA_REACHED':
      return 'same-day capacity for this window is full.';
    case 'PARTS_UNAVAILABLE':
      return 'parts not in stock for this service today.';
    case 'VEHICLE_ALREADY_BOOKED':
      return 'this vehicle already has an overlapping appointment.';
    default:
      return 'the window was taken by a concurrent booking.';
  }
};

export const renderSummary = (type: string, detail: Record<string, unknown>, ctx: HistoryContext): string => {
  switch (type) {
    case 'SLOT_REQUESTED':
      return `Requested ${str(detail.startTime)}–${str(detail.endTime)}`;
    case 'CHECK_FAILED':
      return `Check failed: ${checkFailedReason(detail)} ${alternativesSentence(detail.alternativeCount)}`;
    case 'CHECK_PASSED':
      return `Check passed: ${str(detail.bayName)} and ${str(detail.technicianName)} free ${str(detail.startTime)}–${str(detail.endTime)}`;
    case 'RESOURCES_RESERVED':
      return `Bay and technician reserved together${detail.partsReserved ? ' · parts reserved' : ''}`;
    case 'APPOINTMENT_CREATED':
      return detail.seeded ? 'Appointment record created' : 'Appointment record created · confirmation sent';
    case 'APPOINTMENT_CANCELLED': {
      const reason = str(detail.reason).trim();
      return reason ? `Cancelled by customer: ${reason}` : 'Cancelled by customer';
    }
    case 'CHECKED_IN':
      return 'Checked in';
    case 'APPOINTMENT_NO_SHOW':
      return `Released: not checked in within ${ctx.lateGraceMin} minutes`;
    default:
      return type;
  }
};

export const toHistoryEntry = (row: EventRow, ctx: HistoryContext): HistoryEntry => ({
  type: row.type as HistoryEntry['type'],
  occurredAt: toOffsetIso(row.occurredAt, ctx.timezone),
  summary: renderSummary(row.type, row.detail, ctx),
  detail: row.detail,
});
