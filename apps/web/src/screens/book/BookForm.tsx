import type {
  AppointmentDetail,
  AvailabilitySlot,
  Dealership,
  Problem,
  ServiceType,
  Vehicle,
} from '@scheduler/contracts';
import { useRef, useState } from 'react';
import { ApiError, GENERIC_ERROR, errorMessage } from '../../api/client.js';
import { useAvailability, useCreateAppointment } from '../../api/hooks.js';
import { CUSTOMER_ID } from '../../config.js';
import { businessNow } from '../../lib/now.js';
import { bookableDates, dateShort, durationText, firstWorkingDayAfter, todayIn } from '../../lib/time.js';
import styles from './Book.module.css';
import { Confirmation } from './Confirmation.js';
import { TimePicker } from './TimePicker.js';
import { Summary } from './Summary.js';
import { SKILL_LABEL } from './labels.js';

interface Props {
  dealerships: Dealership[];
  serviceTypes: ServiceType[];
  vehicles: Vehicle[];
}

/** Slot state meaning "the user has not chosen and we must not choose for them" (after a 409). */
const NONE = '';

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
    firstWorkingDayAfter(todayIn(firstDealer.timezone, businessNow(firstDealer.timezone)), firstDealer.workingDays),
  );
  /** null = auto-select the first available slot; NONE = nothing chosen (after a 409); otherwise an explicit start time. */
  const [slot, setSlot] = useState<string | null>(null);
  const [record, setRecord] = useState<AppointmentDetail | null>(null);
  const [conflict, setConflict] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One booking flow = one session id, reused across retries inside the flow.
  const sessionId = useRef<string>(crypto.randomUUID());

  const create = useCreateAppointment();

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? firstVehicle;
  const services = applicable(serviceTypes, vehicle);
  const service = services.find((s) => s.code === serviceCode) ?? services[0];
  const dealer = dealerships.find((d) => d.id === dealerId) ?? firstDealer;

  const today = todayIn(dealer.timezone, businessNow(dealer.timezone));
  const strip = bookableDates(today, dealer.workingDays);
  const dates = strip.includes(date) ? strip : [...strip, date].sort();

  const availability = useAvailability(
    dealer.id,
    { serviceType: service?.code ?? '', date, vehicleId: vehicle.id },
    !record && !!service,
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
    if (!selected || !service || create.isPending) return;
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
            setSlot(NONE);
          } else {
            setError(err instanceof ApiError ? errorMessage(err) : GENERIC_ERROR);
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
          Choose your vehicle, the service and a time. We confirm a time only when a service bay and the right
          technician are both free. A bay is the space where your vehicle is worked on.
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
                  <span className={styles.meta}>{`Plate ${v.plate ?? 'none'} · VIN ends ${v.vinLast4}`}</span>
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
            {services.length === 0 ? (
              <p role="status" className={styles.warn}>
                No services are available for this vehicle. Choose another vehicle.
              </p>
            ) : (
              <div className={styles.choices} data-min="220">
                {services.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    className={styles.choice}
                    aria-pressed={s.code === service?.code}
                    onClick={() => change(() => setServiceCode(s.code))}
                  >
                    <span className={styles.choiceName}>{s.name}</span>
                    <span className={styles.tags}>
                      <span className={styles.duration}>{durationText(s.durationMin)}</span>
                      <span className={styles.tag}>{`Needs ${SKILL_LABEL[s.requiredSkill]} technician`}</span>
                      {s.isExpress ? (
                        <span className={`${styles.tag} ${styles.tagExpress}`}>Express</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            )}
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
                  <span className={styles.meta}>{`${d.bayCount} bays · open ${d.opensAt}–${d.closesAt}`}</span>
                </button>
              ))}
            </div>
          </section>

          {service ? (
            <section aria-labelledby="h-time" className={`${styles.card} ${styles.cardTime}`}>
              <div className={styles.timeHead}>
                <div className={styles.cardHead}>
                  <span className={styles.num}>04</span>
                  <h2 id="h-time" className={styles.h2}>
                    Date and time
                  </h2>
                </div>
                <p className={styles.live}>{`Free times right now · this job takes ${durationText(service.durationMin)}`}</p>
              </div>
              <TimePicker
                dates={dates}
                today={today}
                date={date}
                onDate={(d) => change(() => setDate(d))}
                availability={{
                  data,
                  error: availability.error,
                  loading: availability.isPending && availability.fetchStatus !== 'idle',
                  refetch: () => void availability.refetch(),
                }}
                serviceName={service.name}
                dealerName={dealer.name}
                expressNames={expressNames}
                graceMin={graceMin}
                selectedStart={selected?.startTime ?? null}
                onPick={(s) => {
                  setSlot(s.startTime);
                  clearFeedback();
                }}
                conflict={conflict}
                onAlternative={chooseAlternative}
              />
            </section>
          ) : null}
        </div>

        {service ? (
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
        ) : null}
      </div>
    </main>
  );
}
