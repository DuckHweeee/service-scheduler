import type { AppointmentDetail } from '@scheduler/contracts';
import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { dateLong } from '../../lib/time.js';
import styles from './Book.module.css';
import { BAY_TYPE_LABEL, SKILL_LABEL } from './labels.js';

interface Props {
  record: AppointmentDetail;
  onReset: () => void;
}

export function Confirmation({ record, onReset }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { search } = useLocation();
  useEffect(() => heading.current?.focus(), []);

  const range = `${record.startTime}–${record.endTime}`;
  return (
    <section aria-labelledby="h-done" className={styles.done}>
      <div className={styles.doneHead}>
        <div className={styles.doneBadgeRow}>
          <span className={styles.badge}>
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Confirmed
          </span>
          <span className={styles.ref}>{record.reference}</span>
        </div>
        <h1 id="h-done" ref={heading} tabIndex={-1} className={styles.doneTitle}>
          {`You're booked for ${dateLong(record.localDate)}, ${record.startTime}`}
        </h1>
        <p
          className={styles.doneSub}
        >{`${record.serviceType.name} at ${record.dealership.name} · ${range}`}</p>
      </div>

      <div className={styles.doneBody}>
        <div className={styles.facts4}>
          <div className={styles.fact}>
            <span className={styles.factLabel}>CUSTOMER</span>
            <span className={styles.factMain}>{record.customer.fullName}</span>
            <span className={styles.factSub}>{record.customer.id}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>VEHICLE</span>
            <span
              className={styles.factMain}
            >{`${record.vehicle.modelYear} ${record.vehicle.modelName}`}</span>
            <span
              className={styles.factSub}
            >{`${record.vehicle.id} · VIN ••••${record.vehicle.vinLast4} · ${record.vehicle.plate ?? 'no plate'}`}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>TECHNICIAN</span>
            <span className={styles.factMain}>{record.technician.name}</span>
            <span
              className={styles.factSub}
            >{`${record.technician.id} · ${SKILL_LABEL[record.serviceType.requiredSkill]}`}</span>
          </div>
          <div className={styles.fact}>
            <span className={styles.factLabel}>SERVICE BAY</span>
            <span className={styles.factMain}>{record.serviceBay.name}</span>
            <span
              className={styles.factSub}
            >{`${record.serviceBay.id} · ${BAY_TYPE_LABEL[record.serviceBay.bayType]}`}</span>
          </div>
        </div>

        <p
          className={styles.doneNote}
        >{`Bay and technician are reserved for ${range}. We'll remind you the day before.`}</p>

        <div className={styles.doneActions}>
          <Link to={{ pathname: `/appointments/${record.reference}`, search }} className={styles.primaryLink}>
            View appointment record
          </Link>
          <button type="button" className={styles.secondary} onClick={onReset}>
            Book another service
          </button>
        </div>
      </div>
    </section>
  );
}
