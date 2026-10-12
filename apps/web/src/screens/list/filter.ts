import type { AppointmentSummary } from '@scheduler/contracts';

export type ListTab = 'upcoming' | 'past' | 'cancelled';

export const TABS: { id: ListTab; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'cancelled', label: 'Cancelled or missed' },
];

/** Which tab an appointment belongs to: confirmed ones split on whether they have already ended. */
export function tabOf(a: Pick<AppointmentSummary, 'status' | 'endAt'>, nowMs: number): ListTab {
  if (a.status !== 'CONFIRMED') return 'cancelled';
  return Date.parse(a.endAt) >= nowMs ? 'upcoming' : 'past';
}

/** Appointments of one tab: upcoming soonest first, the others most recent first. */
export function filterAppointments(items: AppointmentSummary[], tab: ListTab, nowMs: number): AppointmentSummary[] {
  const rows = items.filter((a) => tabOf(a, nowMs) === tab);
  const byStart = (a: AppointmentSummary, b: AppointmentSummary) => Date.parse(a.startAt) - Date.parse(b.startAt);
  return rows.sort(tab === 'upcoming' ? byStart : (a, b) => byStart(b, a));
}
