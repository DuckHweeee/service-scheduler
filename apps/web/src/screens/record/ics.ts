import type { AppointmentDetail } from '@scheduler/contracts';

const utcStamp = (ms: number): string =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** A single-event iCalendar file: UID = reference, DTSTART/DTEND in UTC. */
export function buildIcs(a: AppointmentDetail, nowMs: number = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Unified Service Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${a.reference}`,
    `DTSTAMP:${utcStamp(nowMs)}`,
    `DTSTART:${utcStamp(Date.parse(a.startAt))}`,
    `DTEND:${utcStamp(Date.parse(a.endAt))}`,
    `SUMMARY:${escapeText(a.serviceType.name)}`,
    `LOCATION:${escapeText(a.dealership.name)}`,
    `DESCRIPTION:${escapeText(`Appointment ${a.reference}`)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.join('\r\n')}\r\n`;
}

/** Triggers a browser download of the `.ics` file. */
export function downloadIcs(a: AppointmentDetail): void {
  const blob = new Blob([buildIcs(a)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${a.reference}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
