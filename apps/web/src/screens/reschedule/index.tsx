import type { AppointmentDetail, AvailabilitySlot, Dealership, Problem, ServiceType } from '@scheduler/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, GENERIC_ERROR, errorMessage } from '../../api/client.js';
import {
  keys,
  useAppointment,
  useAvailability,
  useDealerships,
  useRescheduleAppointment,
  useServiceTypes,
} from '../../api/hooks.js';
import { businessNow } from '../../lib/now.js';
import { bookableDates, dateLong, dateShort, durationText, todayIn } from '../../lib/time.js';
import styles from '../book/Book.module.css';
import { Summary } from '../book/Summary.js';
import { TimePicker } from '../book/TimePicker.js';
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
    const upcoming = a.status === 'CONFIRMED' && !a.checkedInAt && Date.parse(a.startAt) > businessNow(a.dealership.timezone);
    if (!dealer || !upcoming) {
      return (
        <Shell>
          <div role="alert" className={styles.warn}>
            <p>
              {dealer
                ? "This appointment can't be moved. Only upcoming appointments that are not checked in can be moved."
                : "We can't move this appointment online. Please contact the dealership."}
            </p>
          </div>
          <Link to={{ pathname: `/appointments/${a.reference}`, search }} className={own.back}>
            Back to your appointment
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
          <p>{notFound ? `We couldn't find an appointment with booking number ${reference}.` : errorMessage(failed)}</p>
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
  /** Start time the user picked; null = nothing picked yet (reschedule never picks for the user). */
  const [slot, setSlot] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionId = useRef<string>(crypto.randomUUID());
  const move = useRescheduleAppointment();

  const today = todayIn(dealer.timezone, businessNow(dealer.timezone));
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
  const selected = slot !== null ? slots.find((s) => s.startTime === slot && pickable(s)) : undefined;

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
            {
              replace: true,
              state: { notice: `Appointment moved to ${dateShort(updated.localDate)} ${updated.startTime}.` },
            },
          );
        },
        onError: (err) => {
          if (err instanceof ApiError && err.problem.code === 'SLOT_UNAVAILABLE') {
            setConflict(err.problem);
            setSlot(null);
          } else {
            setError(err instanceof ApiError ? errorMessage(err) : GENERIC_ERROR);
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
    : 'Pick a new time';
  const graceMin = data?.sameDay?.lateGraceMin ?? dealer.sameDayPolicy.lateGraceMin;
  const expressNames = serviceTypes.filter((s) => s.isExpress).map((s) => s.name);
  const vehicleName = `${a.vehicle.modelYear} ${a.vehicle.modelName}`;

  return (
    <main id="reschedule" className={styles.main}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>{`Booking number ${a.reference}`}</p>
        <h1 className={styles.h1}>{`Reschedule ${a.serviceType.name}`}</h1>
        <p className={styles.lede}>
          Pick a new time. Your current time stays yours until the move is done. We move it only when a bay and the
          right technician are both free.
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
              {`Your vehicle (${vehicleName}), the service and the dealership stay the same. To change them, book a new appointment.`}
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
              <p className={styles.live}>{`Free times right now · this job takes ${durationText(a.durationMin)}`}</p>
            </div>
            <TimePicker
              dates={dates}
              today={today}
              date={date}
              onDate={changeDate}
              availability={{
                data,
                error: availability.error,
                loading: availability.isPending && availability.fetchStatus !== 'idle',
                refetch: () => void availability.refetch(),
              }}
              serviceName={a.serviceType.name}
              dealerName={dealer.name}
              expressNames={expressNames}
              graceMin={graceMin}
              selectedStart={selected?.startTime ?? null}
              currentStart={currentStart}
              fixedDealership
              onPick={(s) => {
                setSlot(s.startTime);
                clearFeedback();
              }}
              conflict={conflict}
              onAlternative={chooseAlternative}
            />
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
          showDisabledConfirm
          emptyText="Pick a new time above to see your bay and technician."
        />
      </div>
    </main>
  );
}
