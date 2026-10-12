import type { AppointmentStatus } from '@scheduler/contracts';

/** Display state: a confirmed appointment with a check-in reads "Checked in". */
export type DisplayStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';

export function displayStatus(a: { status: AppointmentStatus; checkedInAt?: string | null }): DisplayStatus {
  return a.status === 'CONFIRMED' && a.checkedInAt ? 'CHECKED_IN' : a.status;
}

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'Missed',
};
