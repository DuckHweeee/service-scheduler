import type { AppointmentDetail } from '@scheduler/contracts';

const utcStamp = (ms: number): string =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** A Google Calendar "quick add" event URL, prefilled with the appointment's details. */
export function buildGoogleCalendarUrl(a: AppointmentDetail): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: a.serviceType.name,
    dates: `${utcStamp(Date.parse(a.startAt))}/${utcStamp(Date.parse(a.endAt))}`,
    location: a.dealership.name,
    details: `Appointment ${a.reference}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Opens Google Calendar's "quick add" page, prefilled, in a new tab. */
export function openGoogleCalendar(a: AppointmentDetail): void {
  window.open(buildGoogleCalendarUrl(a), '_blank', 'noopener,noreferrer');
}
