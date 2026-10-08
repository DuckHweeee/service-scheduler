import type {
  AppointmentDetail,
  AvailabilitySlot,
  Dealership,
  Problem,
  ServiceType,
  Vehicle,
} from '@scheduler/contracts';
import { useRef, useState } from 'react';
import { ApiError, errorMessage } from '../../api/client.js';
import { useAvailability, useCreateAppointment } from '../../api/hooks.js';
import { CUSTOMER_ID } from '../../config.js';
import {
  bookableDates,
  dateShort,
  dayMonthShort,
  durationText,
  firstWorkingDayAfter,
  todayIn,
  weekdayName,
} from '../../lib/time.js';
import styles from './Book.module.css';
import { Confirmation } from './Confirmation.js';
import { SlotGrid } from './SlotGrid.js';
import { Summary } from './Summary.js';
import { SKILL_LABEL } from './labels.js';

interface Props {
  dealerships: Dealership[];
  serviceTypes: ServiceType[];
  vehicles: Vehicle[];
}

const DEFAULT_SERVICE = 'BRAKE_PAD_REPLACEMENT';
const applicable = (services: ServiceType[], vehicle: Vehicle) =>
  services.filter((s) => s.powertrains.includes(vehicle.powertrain));

export function BookForm({ dealerships, serviceTypes, vehicles }: Props) {
  const firstDealer = dealerships[0]!;
  const firstVehicle = vehicles[0]!;
  const [vehicleId, setVehicleId] = useState(firstVehicle.id);
  const [serviceCode, setServiceCode] = useState(
    () =>
      (
        applicable(serviceTypes, firstVehicle).find((s) => s.code === DEFAULT_SERVICE) ??
        applicable(serviceTypes, firstVehicle)[0]
      )?.code ?? '',
  );
  const [dealerId, setDealerId] = useState(firstDealer.id);
  const [date, setDate] = useState(() =>
    firstWorkingDayAfter(todayIn(firstDealer.timezone), firstDealer.workingDays),
  );
  /** null = auto-select the first available slot; otherwise an explicit start time. */
  const [slot, setSlot] = useState<string | null>(null);
  const [record, setRecord] = useState<AppointmentDetail | null>(null);
  const [conflict, setConflict] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One booking flow = one session id, reused across retries inside the flow.
  const sessionId = useRef<string>(crypto.randomUUID());

  const create = useCreateAppointment();

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? firstVehicle;
  const services = applicable(serviceTypes, vehicle);
  const service = services.find((s) => s.code === serviceCode) ?? services[0]!;
  const dealer = dealerships.find((d) => d.id === dealerId) ?? firstDealer;

  const today = todayIn(dealer.timezone);
  const strip = bookableDates(today, dealer.workingDays);
  const dates = strip.includes(date) ? strip : [...strip, date].sort();

  const availability = useAvailability(
    dealer.id,
    { serviceType: service.code, date, vehicleId: vehicle.id },
    !record,
  );
  const data = availability.data;
  const slots: AvailabilitySlot[] = data?.slots ?? [];
  const selected =
    slot !== null
      ? slots.find((s) => s.startTime === slot && s.status === 'AVAILABLE')
      : slots.find((s) => s.status === 'AVAILABLE');

  const clearFeedback = () => {
    setConflict(null);
    setError(null);
  };
  /** Changing vehicle / service / dealer / date clears the slot (then auto-selects the first available). */
  const change = (apply: () => void) => {
    apply();
    setSlot(null);
    clearFeedback();
  };

  const pickVehicle = (v: Vehicle) =>
    change(() => {
      setVehicleId(v.id);
      const next = applicable(serviceTypes, v);
      if (!next.some((s) => s.code === serviceCode) && next[0]) setServiceCode(next[0].code);
    });

  const confirm = () => {
    if (!selected || create.isPending) return;
    clearFeedback();
    create.mutate(
      {
        body: {
          customerId: CUSTOMER_ID,
          vehicleId: vehicle.id,
          dealershipId: dealer.id,
          serviceTypeCode: service.code,
          date,
          startTime: selected.startTime,
          bookingSessionId: sessionId.current,
        },
      },
      {
        onSuccess: (appointment) => setRecord(appointment),
        onError: (err) => {
          if (err instanceof ApiError && err.problem.code === 'SLOT_UNAVAILABLE') {
            setConflict(err.problem);
            setSlot(null);
          } else {
            setError(
              err instanceof ApiError ? err.problem.detail : 'Something went wrong. Please try again.',
            );
          }
        },
      },
    );
  };

  const reset = () => {
    sessionId.current = crypto.randomUUID();
    create.reset();
    setRecord(null);
    setSlot(null);
    clearFeedback();
  };

  const chooseAlternative = (alt: { date: string; startTime: string }) => {
    setDate(alt.date);
    setSlot(alt.startTime);
    clearFeedback();
  };

  if (record) {
    return (
      <main id="book" className={styles.main}>
        <Confirmation record={record} onReset={reset} />
      </main>
    );
  }

  const when = selected
    ? `${dateShort(date)} · ${selected.startTime}–${selected.endTime}`
    : `${dateShort(date)} · pick a time`;
  const graceMin = data?.sameDay?.lateGraceMin ?? dealer.sameDayPolicy.lateGraceMin;
  const expressNames = serviceTypes.filter((s) => s.isExpress).map((s) => s.name);

  return (
    <main id="book" className={styles.main}>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>NEW APPOINTMENT</p>
        <h1 className={styles.h1}>Book a service</h1>
        <p className={styles.lede}>
          We only confirm a time when a service bay and a technician qualified for the job are both free for
          the full duration.
        </p>
      </div>

      <div className={styles.layout}>
        <div className={styles.steps}>
          <section aria-labelledby="h-vehicle" className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.num}>01</span>
              <h2 id="h-vehicle" className={styles.h2}>
                Vehicle
              </h2>
            </div>
            <div className={styles.choices} data-min="240">
              {vehicles.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  className={styles.choice}
                  aria-pressed={v.id === vehicle.id}
                  onClick={() => pickVehicle(v)}
                >
                  <span className={styles.choiceName}>{`${v.modelYear} ${v.modelName}`}</span>
                  <span className={styles.meta}>{`VIN ••••${v.vinLast4} · ${v.plate ?? 'no plate'}`}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="h-service" className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.num}>02</span>
              <h2 id="h-service" className={styles.h2}>
                Service
              </h2>
            </div>
            <div className={styles.choices} data-min="220">
              {services.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  className={styles.choice}
                  aria-pressed={s.code === service.code}
                  onClick={() => change(() => setServiceCode(s.code))}
                >
                  <span className={styles.choiceName}>{s.name}</span>
                  <span className={styles.tags}>
                    <span className={styles.duration}>{durationText(s.durationMin)}</span>
                    <span className={styles.tag}>{`Needs ${SKILL_LABEL[s.requiredSkill]}`}</span>
                    {s.isExpress ? (
                      <span className={`${styles.tag} ${styles.tagExpress}`}>Express</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="h-dealer" className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.num}>03</span>
              <h2 id="h-dealer" className={styles.h2}>
                Dealership
              </h2>
            </div>
            <div className={styles.choices} data-min="220">
              {dealerships.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className={styles.choice}
                  aria-pressed={d.id === dealer.id}
                  onClick={() => change(() => setDealerId(d.id))}
                >
                  <span className={styles.choiceName}>{d.name}</span>
                  <span className={styles.meta}>{`${d.bayCount} bays · ${d.opensAt}–${d.closesAt}`}</span>
                </button>
              ))}
            </div>
          </section>

          <section aria-labelledby="h-time" className={`${styles.card} ${styles.cardTime}`}>
            <div className={styles.timeHead}>
              <div className={styles.cardHead}>
                <span className={styles.num}>04</span>
                <h2 id="h-time" className={styles.h2}>
                  Date and time
                </h2>
              </div>
              <p className={styles.live}>{`Live availability · ${durationText(service.durationMin)} job`}</p>
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
                    onClick={() => change(() => setDate(d))}
                  >
                    <span className={styles.dateWd}>
                      {isToday ? 'TODAY' : weekdayName(d, true).toUpperCase()}
                    </span>
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
              >{`${service.name} can't be booked for today. Same-day booking covers express services: ${expressNames.join(', ')}.`}</p>
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
                  onPick={(s) => {
                    setSlot(s.startTime);
                    clearFeedback();
                  }}
                />
                {data && !slots.some((s) => s.status === 'AVAILABLE') ? (
                  <p className={styles.warn}>
                    No time this day has both a free bay and a qualified technician for the whole job. Try
                    another date or dealership.
                  </p>
                ) : null}
              </>
            )}
          </section>
        </div>

        <Summary
          vehicleName={`${vehicle.modelYear} ${vehicle.modelName}`}
          serviceLine={`${service.name} · ${durationText(service.durationMin)}`}
          dealerName={dealer.name}
          when={when}
          durationLabel={durationText(service.durationMin)}
          selected={selected ?? null}
          skill={SKILL_LABEL[service.requiredSkill]}
          checking={create.isPending}
          error={error}
          onConfirm={confirm}
        />
      </div>
    </main>
  );
}
