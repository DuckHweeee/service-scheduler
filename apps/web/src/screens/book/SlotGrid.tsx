import type { AvailabilitySlot } from '@scheduler/contracts';
import styles from './Book.module.css';
import { slotAriaLabel, slotLabel } from './labels.js';

interface Props {
  slots: AvailabilitySlot[];
  selectedStart: string | null;
  onPick: (slot: AvailabilitySlot) => void;
}

export function SlotGrid({ slots, selectedStart, onPick }: Props) {
  return (
    <div role="group" aria-label="Start time" className={styles.slots}>
      {slots.map((s) => {
        const open = s.status === 'AVAILABLE';
        const picked = open && s.startTime === selectedStart;
        const cls = [
          styles.slot,
          picked ? styles.slotPicked : open ? styles.slotOpen : styles.slotOff,
          !open && s.status === 'NO_QUALIFIED_TECHNICIAN' ? styles.slotNoTech : '',
        ]
          .filter(Boolean)
          .join(' ');
        return (
          <button
            key={s.startAt}
            type="button"
            className={cls}
            aria-pressed={picked}
            aria-label={slotAriaLabel(s)}
            disabled={!open}
            onClick={() => onPick(s)}
          >
            <span className={styles.slotTime}>{s.startTime}</span>
            <span className={styles.slotStatus}>{slotLabel(s)}</span>
          </button>
        );
      })}
    </div>
  );
}
