import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './Record.module.css';

interface Props {
  reference: string;
  summary: string;
  pending: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), textarea:not([disabled]), a[href]';

/** Modal ARIA dialog with a focus trap. Escape and the backdrop close it; focus returns to the opener. */
export function CancelDialog({ reference, summary, pending, error, onConfirm, onClose }: Props) {
  const titleId = useId();
  const descId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState('');

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('textarea')?.focus();
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!pending) onClose();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={styles.dialog}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.dialogTitle}>
          Cancel this appointment?
        </h2>
        <p id={descId} className={styles.dialogText}>
          {`${summary} (${reference}) will be released. The bay and technician become available to other customers.`}
        </p>
        <label className={styles.dialogLabel}>
          <span>Reason (optional)</span>
          <textarea
            className={styles.dialogInput}
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className={styles.dialogError}>
            {error}
          </p>
        )}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.keepBtn} onClick={onClose} disabled={pending}>
            Keep appointment
          </button>
          <button
            type="button"
            className={styles.dangerBtn}
            onClick={() => onConfirm(reason.trim())}
            disabled={pending}
          >
            {pending ? 'Cancelling…' : 'Confirm cancellation'}
          </button>
        </div>
      </div>
    </div>
  );
}
