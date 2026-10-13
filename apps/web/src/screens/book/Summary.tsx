import type { AvailabilitySlot } from '@scheduler/contracts';
import styles from './Book.module.css';
import { BAY_TYPE_LABEL } from './labels.js';

interface Props {
  vehicleName: string;
  serviceLine: string;
  dealerName: string;
  when: string;
  durationLabel: string;
  selected: AvailabilitySlot | null;
  skill: string;
  checking: boolean;
  error: string | null;
  onConfirm: () => void;
  /** Defaults to "Confirm appointment"; the reschedule screen says "Move appointment". */
  confirmLabel?: string;
  /** Show the button (disabled) even before a time is chosen. Reschedule uses it; Book shows it after a pick. */
  showDisabledConfirm?: boolean;
  /** Sentence shown while no time is chosen. */
  emptyText?: string;
}

function Tick() {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--accent-on-dark)"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={styles.tick}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function Summary({
  vehicleName,
  serviceLine,
  dealerName,
  when,
  durationLabel,
  selected,
  skill,
  checking,
  error,
  onConfirm,
  confirmLabel = 'Confirm appointment',
  showDisabledConfirm = false,
  emptyText = 'Pick a free time to see your bay and technician.',
}: Props) {
  const proposed = selected?.proposed ?? null;
  const window = selected ? `${selected.startTime}–${selected.endTime}` : '';
  return (
    <aside aria-labelledby="h-summary" className={styles.summary}>
      <h2 id="h-summary" className={styles.summaryTitle}>
        Your appointment
      </h2>
      <dl className={styles.facts}>
        <div>
          <dt>VEHICLE</dt>
          <dd>{vehicleName}</dd>
        </div>
        <div>
          <dt>SERVICE</dt>
          <dd>{serviceLine}</dd>
        </div>
        <div>
          <dt>DEALERSHIP</dt>
          <dd>{dealerName}</dd>
        </div>
        <div>
          <dt>WHEN</dt>
          <dd>{when}</dd>
        </div>
      </dl>

      <div className={styles.check}>
        <h3 className={styles.checkTitle}>WHAT WE&apos;LL RESERVE</h3>
        {selected && proposed ? (
          <>
            <ul className={styles.checkList}>
              <li>
                <Tick />
                <div>
                  <span className={styles.checkMain}>{`Service bay · ${proposed.serviceBay.name}`}</span>
                  <span
                    className={styles.checkSub}
                  >{`${BAY_TYPE_LABEL[proposed.serviceBay.bayType]} · free ${window}`}</span>
                </div>
              </li>
              <li>
                <Tick />
                <div>
                  <span className={styles.checkMain}>{`Technician · ${proposed.technician.name}`}</span>
                  <span className={styles.checkSub}>{`Trained for ${skill} · free ${window}`}</span>
                </div>
              </li>
              <li>
                <Tick />
                <div>
                  <span className={styles.checkMain}>Enough time for the whole job</span>
                  <span className={styles.checkSub}>{`${durationLabel}, with no other booking in the way`}</span>
                </div>
              </li>
            </ul>
            <p className={styles.checkNote}>
              We check again and reserve both the moment you confirm.
            </p>
            {error ? (
              <p role="alert" className={styles.inlineError}>
                {error}
              </p>
            ) : null}
            <button
              type="button"
              className={styles.confirm}
              onClick={onConfirm}
              disabled={checking}
              aria-busy={checking}
            >
              {checking ? 'Reserving your bay and technician…' : confirmLabel}
            </button>
          </>
        ) : (
          <>
            <p className={styles.checkEmpty}>{emptyText}</p>
            {error ? (
              <p role="alert" className={styles.inlineError}>
                {error}
              </p>
            ) : null}
            {showDisabledConfirm ? (
              <button type="button" className={styles.confirm} disabled>
                {confirmLabel}
              </button>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
