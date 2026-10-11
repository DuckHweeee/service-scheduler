// Dealership-local time helpers. Dates are `YYYY-MM-DD`, times are `HH:mm`, minutes are since local midnight.

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export function fmtMin(m: number): string {
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function parseMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function partsOf(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Local date and minutes-since-midnight of an instant in a timezone. */
export function zonedNow(ms: number, tz: string): { date: string; minutes: number } {
  const p = partsOf(ms, tz);
  return { date: `${p.year}-${pad2(p.month)}-${pad2(p.day)}`, minutes: p.hour * 60 + p.minute };
}

/** UTC offset (minutes) of a timezone at an instant. */
export function offsetMinutes(ms: number, tz: string): number {
  const p = partsOf(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

function dateParts(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}

/** Instant (ms) of a dealership-local date + minutes. */
export function zonedToMs(date: string, minutes: number, tz: string): number {
  const [y, m, d] = dateParts(date);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  const guess = naive - offsetMinutes(naive, tz) * 60000;
  return naive - offsetMinutes(guess, tz) * 60000;
}

function offsetSuffix(offMin: number): string {
  const sign = offMin < 0 ? '-' : '+';
  const abs = Math.abs(offMin);
  return `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

/** ISO 8601 with the timezone's offset, e.g. `2026-10-08T13:00:00+07:00`. */
export function toOffsetIso(ms: number, tz: string): string {
  const p = partsOf(ms, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}${offsetSuffix(offsetMinutes(ms, tz))}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = dateParts(date);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const [y, m, d] = dateParts(date);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function dayOrdinal(date: string): number {
  const [y, m, d] = dateParts(date);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function daysBetween(from: string, to: string): number {
  return dayOrdinal(to) - dayOrdinal(from);
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function weekdayName(date: string, short = false): string {
  const name = WEEKDAYS[isoWeekday(date) - 1] ?? '';
  return short ? name.slice(0, 3) : name;
}

export function monthName(date: string, short = false): string {
  const name = MONTHS[dateParts(date)[1] - 1] ?? '';
  return short ? name.slice(0, 3) : name;
}

/** `8 Oct` */
export const dayMonthShort = (date: string): string => `${dateParts(date)[2]} ${monthName(date, true)}`;
/** `Thu 8 Oct` */
export const dateShort = (date: string): string => `${weekdayName(date, true)} ${dayMonthShort(date)}`;
/** `Thursday 8 October` */
export const dateLong = (date: string): string =>
  `${weekdayName(date)} ${dateParts(date)[2]} ${monthName(date)}`;

/** `Wed 7 Oct 2026, 14:02` — an instant rendered in the given timezone. */
export function dateTimeShort(iso: string, tz: string): string {
  const { date, minutes } = zonedNow(Date.parse(iso), tz);
  return `${dateShort(date)} ${date.slice(0, 4)}, ${fmtMin(minutes)}`;
}

export function durationText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}

/** Today's date in a timezone (real clock). */
export function todayIn(tz: string, nowMs: number = Date.now()): string {
  return zonedNow(nowMs, tz).date;
}

/** Today (when a working day) followed by the next `count` working days after it. */
export function bookableDates(today: string, workingDays: number[], count = 5): string[] {
  const out: string[] = [];
  if (workingDays.includes(isoWeekday(today))) out.push(today);
  let d = today;
  let following = 0;
  while (following < count) {
    d = addDays(d, 1);
    if (workingDays.includes(isoWeekday(d))) {
      out.push(d);
      following += 1;
    }
  }
  return out;
}

export function firstWorkingDayAfter(today: string, workingDays: number[]): string {
  let d = addDays(today, 1);
  while (!workingDays.includes(isoWeekday(d))) d = addDays(d, 1);
  return d;
}
