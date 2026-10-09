// Timezone utilities (SPEC A2). The only place (besides the DB layer) that converts between instants and local
// wall-clock values. The availability engine itself works purely in "minutes since local midnight".
import { DateTime } from 'luxon';
import type { Clock } from '../clock.js';

/** `'13:00'` (or `'13:00:00'`) → 780. */
export const parseLocalTime = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(hhmm);
  if (!m) throw new Error(`Invalid local time: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) throw new Error(`Invalid local time: ${hhmm}`);
  return h * 60 + min;
};

/** 780 → `'13:00'`. */
export const formatLocalTime = (minutes: number): string => {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 24 * 60) throw new Error(`Invalid minutes: ${minutes}`);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const parseDate = (localDate: string): { year: number; month: number; day: number } => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!m) throw new Error(`Invalid local date: ${localDate}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
};

const utcDate = (localDate: string): DateTime => {
  const dt = DateTime.fromObject(parseDate(localDate), { zone: 'utc' });
  if (!dt.isValid) throw new Error(`Invalid local date: ${localDate}`);
  return dt;
};

const inZone = (instant: Date, tz: string): DateTime => {
  const dt = DateTime.fromJSDate(instant, { zone: tz });
  if (!dt.isValid) throw new Error(`Invalid instant/timezone: ${String(instant)} ${tz}`);
  return dt;
};

/** Local date + minutes-since-midnight in `tz` → UTC instant. Uses wall-clock fields, so DST-safe. */
export const toInstant = (localDate: string, minutes: number, tz: string): Date => {
  const { year, month, day } = parseDate(localDate);
  const dt = DateTime.fromObject(
    { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
    { zone: tz },
  );
  if (!dt.isValid) throw new Error(`Invalid local datetime: ${localDate} ${minutes} ${tz}`);
  return dt.toJSDate();
};

/** `2026-10-08T13:00:00+07:00` (seconds precision, no milliseconds). */
export const toOffsetIso = (instant: Date, tz: string): string => {
  const iso = inZone(instant, tz).toISO({ suppressMilliseconds: true });
  if (!iso) throw new Error('Unable to format instant');
  return iso;
};

export const localDateOf = (instant: Date, tz: string): string => inZone(instant, tz).toFormat('yyyy-MM-dd');

export const localMinutesOf = (instant: Date, tz: string): number => {
  const dt = inZone(instant, tz);
  return dt.hour * 60 + dt.minute;
};

/** Like `localMinutesOf`, but any part of a minute counts as a full one (09:30:30 → 09:31): for "no earlier than". */
export const localMinutesCeilOf = (instant: Date, tz: string): number => {
  const dt = inZone(instant, tz);
  return dt.hour * 60 + dt.minute + (dt.second > 0 || dt.millisecond > 0 ? 1 : 0);
};

export const localToday = (clock: Clock, tz: string): string => localDateOf(clock.now(), tz);

export const addLocalDays = (localDate: string, n: number): string => utcDate(localDate).plus({ days: n }).toFormat('yyyy-MM-dd');

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (localDate: string): number => utcDate(localDate).weekday;

export const isWorkingDay = (localDate: string, workingDays: readonly number[]): boolean =>
  workingDays.includes(isoWeekday(localDate));

/** The next `n` working days strictly after `fromLocalDate`. */
export const nextWorkingDays = (fromLocalDate: string, n: number, workingDays: readonly number[]): string[] => {
  if (workingDays.length === 0) return [];
  const out: string[] = [];
  let cursor = fromLocalDate;
  while (out.length < n) {
    cursor = addLocalDays(cursor, 1);
    if (isWorkingDay(cursor, workingDays)) out.push(cursor);
  }
  return out;
};
