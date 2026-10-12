import type { AvailabilitySlot } from '@scheduler/contracts';
import styles from './Book.module.css';
import { slotAriaLabel, slotLabel } from './labels.js';

interface Props {
  slots: AvailabilitySlot[];
  selectedStart: string | null;
  onPick: (slot: AvailabilitySlot) => void;
  /** Reschedule only: start time of the appointment's current slot; shown as "Current" and not selectable. */
  currentStart?: string | null;
}

export function SlotGrid({ slots, selectedStart, onPick, currentStart = null }: Props) {
  return (
    <div role="group" aria-label="Start time" className={styles.slots}>
      {slots.map((s) => {
        const current = currentStart !== null && s.startTime === currentStart;
        const open = s.status === 'AVAILABLE' && !current;
        const picked = open && s.startTime === selectedStart;
        const cls = [
          styles.slot,
          picked ? styles.slotPicked : open ? styles.slotOpen : styles.slotOff,
          !open && !current && s.status === 'NO_QUALIFIED_TECHNICIAN' ? styles.slotNoTech : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={s.startAt}
            type="button"
            className={cls}
            aria-pressed={picked}
            aria-label={current ? `${s.startTime} to ${s.endTime}, Current` : slotAriaLabel(s)}
            disabled={!open}
            onClick={() => onPick(s)}
          >
            <span className={styles.slotTime}>{s.startTime}</span>
            <span className={styles.slotStatus}>{current ? 'Current' : slotLabel(s)}</span>
          </button>
        );
      })}
    </div>
  );
}
