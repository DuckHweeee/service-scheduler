import type { AvailabilityResponse, AvailabilitySlot, Problem } from '@scheduler/contracts';
import { useEffect, useRef } from 'react';
import { errorMessage } from '../../api/client.js';
import { dateShort, dayMonthShort, weekdayName } from '../../lib/time.js';
import styles from './Book.module.css';
import { SlotGrid } from './SlotGrid.js';

interface AvailabilityState {
  data: AvailabilityResponse | undefined;
  error: unknown;
  /** True while the first load for the current query is running. */
  loading: boolean;
  refetch: () => void;
}

interface Props {
  /** The date strip: Today (when a working day) plus the next working days. */
  dates: string[];
  today: string;
  date: string;
  onDate: (date: string) => void;
  availability: AvailabilityState;
  serviceName: string;
  dealerName: string;
  expressNames: string[];
  graceMin: number;
  /** Start time chosen by the user (or auto-selected by Book); null = nothing chosen. */
  selectedStart: string | null;
  onPick: (slot: AvailabilitySlot) => void;
  /** A 409 answer to show above the dates, with its alternatives. */
  conflict: Problem | null;
  onAlternative: (alt: { date: string; startTime: string }) => void;
  /** Reschedule only: start time of the current slot on the shown date; shown as "Current", not selectable. */
  currentStart?: string | null;
  /** Reschedule only: the dealership cannot change, so never suggest "another dealership". */
  fixedDealership?: boolean;
}

/** Date strip, legend, slot grid and every availability state shared by Book and Reschedule. */
export function TimePicker({
  dates,
  today,
  date,
  onDate,
  availability,
  serviceName,
  dealerName,
  expressNames,
  graceMin,
  selectedStart,
  onPick,
  conflict,
  onAlternative,
  currentStart = null,
  fixedDealership = false,
}: Props) {
  const { data } = availability;
  const slots: AvailabilitySlot[] = data?.slots ?? [];
  const pickable = (s: AvailabilitySlot) => s.status === 'AVAILABLE' && s.startTime !== currentStart;

  // After a 409 move focus to the panel so keyboard and screen-reader users hear what happened.
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (conflict) panel.current?.focus();
  }, [conflict]);

  return (
    <>
      {conflict ? (
        <div ref={panel} tabIndex={-1} role="alert" className={styles.conflict}>
          <p className={styles.conflictTitle}>Someone just booked that time.</p>
          <p>{conflict.detail}</p>
          {conflict.alternatives?.length ? (
            <>
              <p className={styles.conflictLead}>Closest free times. Pick one:</p>
              <ul className={styles.alts}>
                {conflict.alternatives.map((alt) => (
                  <li key={`${alt.date}-${alt.startTime}`}>
                    <button type="button" className={styles.alt} onClick={() => onAlternative(alt)}>
                      {`${dateShort(alt.date)} · ${alt.startTime}–${alt.endTime}`}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      ) : null}

      <div role="group" aria-label="Date" className={styles.dates}>
        {dates.map((d) => {
          const isToday = d === today;
          return (
            <button
              key={d}
              type="button"
              className={styles.date}
              aria-label={`${isToday ? 'Today, ' : ''}${dateShort(d)}${isToday ? ', same-day booking' : ''}`}
              aria-pressed={d === date}
              onClick={() => onDate(d)}
            >
              <span className={styles.dateWd}>{isToday ? 'TODAY' : weekdayName(d, true).toUpperCase()}</span>
              <span className={styles.dateDay}>{dayMonthShort(d)}</span>
              {isToday ? <span className={styles.sameDayChip}>SAME-DAY</span> : null}
            </button>
          );
        })}
      </div>

      {date === today || data?.sameDay ? (
        <p className={styles.notice}>
          {`Same-day booking is for express jobs only. Please arrive on time. If you are more than ${graceMin} minutes late, we give your time to someone else.`}
        </p>
      ) : null}

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span aria-hidden="true" className={`${styles.swatch} ${styles.swFree}`} />
          Bay and technician free
        </span>
        <span className={styles.legendItem}>
          <span aria-hidden="true" className={`${styles.swatch} ${styles.swSelected}`} />
          Your choice
        </span>
        <span className={styles.legendItem}>
          <span aria-hidden="true" className={`${styles.swatch} ${styles.swOff}`} />
          Not free for the whole job
        </span>
      </div>

      {availability.loading ? (
        <p role="status" className={styles.muted}>
          Looking for free times…
        </p>
      ) : availability.error ? (
        <div role="alert" className={styles.warn}>
          <p>{errorMessage(availability.error)}</p>
          <button type="button" className={styles.retry} onClick={availability.refetch}>
            Try again
          </button>
        </div>
      ) : data?.sameDay?.blocked === 'SERVICE_NOT_EXPRESS' ? (
        <p
          className={styles.warn}
        >{`${serviceName} can't be booked for today. Today we only take express jobs: ${expressNames.join(', ')}. Pick another day for this service.`}</p>
      ) : data?.sameDay?.blocked === 'PARTS_UNAVAILABLE' ? (
        <p className={styles.warn}>
          {fixedDealership
            ? `We don't have the parts for this service at ${dealerName} today. Try another day.`
            : `We don't have the parts for this service at ${dealerName} today. Try another dealership or another day.`}
        </p>
      ) : data?.sameDay?.blocked === 'PAST_CUTOFF' ? (
        <p
          className={styles.warn}
        >{`Booking for today is closed. Same-day jobs must start at least ${data.sameDay.leadTimeMin / 60} hours from now. Pick another day.`}</p>
      ) : (
        <>
          <SlotGrid slots={slots} selectedStart={selectedStart} currentStart={currentStart} onPick={onPick} />
          {data && !slots.some(pickable) ? (
            <p className={styles.warn}>
              {fixedDealership
                ? 'No other free times on this day. Try another day.'
                : 'No free times on this day. Try another day or another dealership.'}
            </p>
          ) : null}
        </>
      )}
    </>
  );
}
