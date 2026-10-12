import type { AppointmentDetail, AvailabilitySlot, Dealership, Problem, ServiceType } from '@scheduler/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client.js';
import {
  keys,
  useAppointment,
  useAvailability,
  useDealerships,
  useRescheduleAppointment,
  useServiceTypes,
} from '../../api/hooks.js';
import {
  bookableDates,
  dateLong,
  dateShort,
  dayMonthShort,
  durationText,
  todayIn,
  weekdayName,
} from '../../lib/time.js';
import styles from '../book/Book.module.css';
import { SlotGrid } from '../book/SlotGrid.js';
import { Summary } from '../book/Summary.js';
import { SKILL_LABEL } from '../book/labels.js';
import own from './Reschedule.module.css';

function Shell({ children }: { children: ReactNode }) {
  return (
    <main id="reschedule" className={styles.main}>
      {children}
    </main>
  );
}

/** Loads the appointment and reference data, then renders the reschedule flow. */
export function RescheduleScreen() {
  const { reference = '' } = useParams();
  const { search } = useLocation();
  const appointment = useAppointment(reference);
  const dealerships = useDealerships();
  const serviceTypes = useServiceTypes();

  const failed = appointment.error ?? dealerships.error ?? serviceTypes.error;
  if (appointment.data && dealerships.data && serviceTypes.data) {
    const a = appointment.data;
    const dealer = dealerships.data.items.find((d) => d.id === a.dealership.id);
    const upcoming = a.status === 'CONFIRMED' && !a.checkedInAt && Date.parse(a.startAt) > Date.now();
    if (!dealer || !upcoming) {
      return (
        <Shell>
          <div role="alert" className={styles.warn}>
            <p>
              {dealer
                ? 'Only upcoming confirmed appointments that have not checked in can be rescheduled.'
                : 'This dealership is not available for rescheduling.'}
            </p>
          </div>
          <Link to={{ pathname: `/appointments/${a.reference}`, search }} className={own.back}>
            Back to appointment
          </Link>
        </Shell>
      );
    }
    return <RescheduleForm a={a} dealer={dealer} serviceTypes={serviceTypes.data.items} />;
  }
  if (failed) {
    const notFound = failed instanceof ApiError && failed.status === 404;
    return (
      <Shell>
        <div role="alert" className={styles.warn}>
          <p>{notFound ? `We couldn't find an appointment with reference ${reference}.` : errorMessage(failed)}</p>
          {notFound ? null : (
            <button
              type="button"
              className={styles.retry}
              onClick={() => {
                for (const q of [appointment, dealerships, serviceTypes]) if (q.isError) void q.refetch();
              }}
            >
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }
  return (
    <Shell>
      <p role="status" className={styles.muted}>
        Loading appointment…
      </p>
    </Shell>
  );
}

interface FormProps {
  a: AppointmentDetail;
  dealer: Dealership;
  serviceTypes: ServiceType[];
}

function RescheduleForm({ a, dealer, serviceTypes }: FormProps) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const qc = useQueryClient();
  const [date, setDate] = useState(a.localDate);
  /** null = auto-select the first other available slot; otherwise an explicit start time. */
  const [slot, setSlot] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string>(crypto.randomUUID());
  const move = useRescheduleAppointment();

  const today = todayIn(dealer.timezone);
  const strip = bookableDates(today, dealer.workingDays);
  const dates = strip.includes(date) ? strip : [...strip, date].sort();

  const availability = useAvailability(dealer.id, {
    serviceType: a.serviceType.code,
    date,
    vehicleId: a.vehicle.id,
    excludeReference: a.reference,
  });
  const data = availability.data;
  const slots: AvailabilitySlot[] = data?.slots ?? [];
  const currentStart = date === a.localDate ? a.startTime : null;
  const pickable = (s: AvailabilitySlot) => s.status === 'AVAILABLE' && s.startTime !== currentStart;
  const selected =
    slot !== null ? slots.find((s) => s.startTime === slot && pickable(s)) : slots.find(pickable);

  const clearFeedback = () => {
    setConflict(null);
    setError(null);
  };
  const changeDate = (d: string) => {
    setDate(d);
    setSlot(null);
    clearFeedback();
  };

  const confirm = () => {
    if (!selected || move.isPending) return;
    clearFeedback();
    move.mutate(
      {
        reference: a.reference,
        body: { date, startTime: selected.startTime, bookingSessionId: sessionId.current },
      },
      {
        onSuccess: (updated) => {
          qc.setQueryData(keys.appointment(a.reference), updated);
          void navigate(
            { pathname: `/appointments/${updated.reference}`, search },
            { state: { notice: `Appointment moved to ${dateShort(updated.localDate)} ${updated.startTime}.` } },
          );
        },
        onError: (err) => {
          if (err instanceof ApiError && err.problem.code === 'SLOT_UNAVAILABLE') {
            setConflict(err.problem);
            setSlot(null);
          } else {
            setError(err instanceof ApiError ? err.problem.detail : 'Something went wrong. Please try again.');
          }
        },
      },
    );
  };

  const chooseAlternative = (alt: { date: string; startTime: string }) => {
    setDate(alt.date);
    setSlot(alt.startTime);
    clearFeedback();
  };

  const when = selected
    ? `${dateShort(date)} · ${selected.startTime}–${selected.endTime}`
    : `${dateShort(date)} · pick a time`;
  const graceMin = data?.sameDay?.lateGraceMin ?? dealer.sameDayPolicy.lateGraceMin;
  const expressNames = serviceTypes.filter((s) => s.isExpress).map((s) => s.name);
  const vehicleName = `${a.vehicle.modelYear} ${a.vehicle.modelName}`;

  return (
    <main id="reschedule" className={styles.main}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{a.reference}</p>
        <h1 className={styles.h1}>{`Reschedule ${a.serviceType.name}`}</h1>
        <p className={styles.lede}>
          Pick a new time. We move your appointment only when a service bay and a qualified technician are both
          free for the full duration, and your current slot stays yours until then.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.steps}>
          <section aria-labelledby="h-current" className={`${styles.card} ${own.current}`}>
            <div className={styles.cardHead}>
              <h2 id="h-current" className={styles.h2}>
                Current
              </h2>
            </div>
            <dl className={own.currentGrid}>
              <div>
                <dt>DATE</dt>
                <dd>{dateLong(a.localDate)}</dd>
              </div>
              <div>
                <dt>TIME</dt>
                <dd>{`${a.startTime}–${a.endTime}`}</dd>
              </div>
              <div>
                <dt>SERVICE BAY</dt>
                <dd>{a.serviceBay.name}</dd>
              </div>
              <div>
                <dt>TECHNICIAN</dt>
                <dd>{a.technician.name}</dd>
              </div>
              <div>
                <dt>DEALERSHIP</dt>
                <dd>{a.dealership.name}</dd>
              </div>
            </dl>
            <p className={own.fixed}>
              {`${vehicleName}, ${a.serviceType.name} and ${a.dealership.name} stay the same. To change them, book a new appointment.`}
            </p>
          </section>

          <section aria-labelledby="h-time" className={`${styles.card} ${styles.cardTime}`}>
            <div className={styles.timeHead}>
              <div className={styles.cardHead}>
                <span className={styles.num}>01</span>
                <h2 id="h-time" className={styles.h2}>
                  New date and time
                </h2>
              </div>
              <p className={styles.live}>{`Live availability · ${durationText(a.durationMin)} job`}</p>
            </div>

            {conflict ? (
              <div role="alert" className={styles.conflict}>
                <p className={styles.conflictTitle}>That time is no longer available.</p>
                <p>{conflict.detail}</p>
                {conflict.alternatives?.length ? (
                  <>
                    <p className={styles.conflictLead}>Closest open times:</p>
                    <ul className={styles.alts}>
                      {conflict.alternatives.map((alt) => (
                        <li key={`${alt.date}-${alt.startTime}`}>
                          <button type="button" className={styles.alt} onClick={() => chooseAlternative(alt)}>
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
                    onClick={() => changeDate(d)}
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
                {`Same-day booking covers express maintenance only. Please arrive on time — same-day bookings are released if you are more than ${graceMin} minutes late.`}
              </p>
            ) : null}

            <div className={styles.legend}>
              <span className={styles.legendItem}>
                <span aria-hidden="true" className={`${styles.swatch} ${styles.swFree}`} />
                Bay and technician free
              </span>
              <span className={styles.legendItem}>
                <span aria-hidden="true" className={`${styles.swatch} ${styles.swSelected}`} />
                Selected
              </span>
              <span className={styles.legendItem}>
                <span aria-hidden="true" className={`${styles.swatch} ${styles.swOff}`} />
                Can't cover the full job
              </span>
            </div>

            {availability.isPending && availability.fetchStatus !== 'idle' ? (
              <p role="status" className={styles.muted}>
                Loading availability…
              </p>
            ) : availability.error ? (
              <div role="alert" className={styles.warn}>
                <p>{errorMessage(availability.error)}</p>
                <button type="button" className={styles.retry} onClick={() => void availability.refetch()}>
                  Try again
                </button>
              </div>
            ) : data?.sameDay?.blocked === 'SERVICE_NOT_EXPRESS' ? (
              <p
                className={styles.warn}
              >{`${a.serviceType.name} can't be booked for today. Same-day booking covers express services: ${expressNames.join(', ')}.`}</p>
            ) : data?.sameDay?.blocked === 'PARTS_UNAVAILABLE' ? (
              <p
                className={styles.warn}
              >{`Parts for this service aren't in stock at ${dealer.name} today. Try another dealership or a later date.`}</p>
            ) : data?.sameDay?.blocked === 'PAST_CUTOFF' ? (
              <p
                className={styles.warn}
              >{`Same-day booking for today has closed. Earliest same-day start is ${data.sameDay.leadTimeMin / 60} hours ahead.`}</p>
            ) : (
              <>
                <SlotGrid
                  slots={slots}
                  selectedStart={selected?.startTime ?? null}
                  currentStart={currentStart}
                  onPick={(s) => {
                    setSlot(s.startTime);
                    clearFeedback();
                  }}
                />
                {data && !slots.some(pickable) ? (
                  <p className={styles.warn}>
                    No other time this day has both a free bay and a qualified technician for the whole job. Try
                    another date.
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>

        <Summary
          vehicleName={vehicleName}
          serviceLine={`${a.serviceType.name} · ${durationText(a.durationMin)}`}
          dealerName={a.dealership.name}
          when={when}
          durationLabel={durationText(a.durationMin)}
          selected={selected ?? null}
          skill={SKILL_LABEL[a.serviceType.requiredSkill]}
          checking={move.isPending}
          error={error}
          onConfirm={confirm}
          confirmLabel="Move appointment"
        />
      </div>
    </main>
  );
}
