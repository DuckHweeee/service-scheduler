import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { errorMessage } from '../../api/client.js';
import { useAppointments } from '../../api/hooks.js';
import { CUSTOMER_ID } from '../../config.js';
import { DEFAULT_TZ, businessNow } from '../../lib/now.js';
import { dateShort } from '../../lib/time.js';
import { STATUS_LABEL, displayStatus } from '../record/status.js';
import { TABS, filterAppointments, tabOf } from './filter.js';
import type { ListTab } from './filter.js';
import styles from './List.module.css';

const EMPTY: Record<ListTab, string> = {
  upcoming: 'No upcoming appointments.',
  past: 'No past appointments yet.',
  cancelled: 'No cancelled or missed appointments.',
};

export function AppointmentsScreen() {
  const { search } = useLocation();
  const query = useAppointments(CUSTOMER_ID);
  const [tab, setTab] = useState<ListTab>('upcoming');
  const base = useId();
  const nowMs = businessNow(DEFAULT_TZ);

  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  const counts = useMemo(() => {
    const c: Record<ListTab, number> = { upcoming: 0, past: 0, cancelled: 0 };
    for (const a of items) c[tabOf(a, nowMs)] += 1;
    return c;
  }, [items, nowMs]);
  const rows = useMemo(() => filterAppointments(items, tab, nowMs), [items, tab, nowMs]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length]!;
    setTab(target.id);
    document.getElementById(`${base}-tab-${target.id}`)?.focus();
  };

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>YOUR SERVICE HISTORY</p>
          <h1 className={styles.h1}>My appointments</h1>
        </div>
        <Link to={{ pathname: '/book', search }} className={styles.cta}>
          Book a service
        </Link>
      </div>

      <div role="tablist" aria-label="Appointment status" className={styles.tabs} onKeyDown={onKeyDown}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`${base}-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${base}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? `${styles.tab} ${styles.tabOn}` : styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {query.isSuccess && <span className={styles.count}>{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      <section id={`${base}-panel`} role="tabpanel" aria-labelledby={`${base}-tab-${tab}`} className={styles.panel}>
        {query.isPending && (
          <p role="status" className={styles.state}>
            Loading appointments…
          </p>
        )}
        {query.isError && (
          <div role="alert" className={styles.state}>
            <p>{errorMessage(query.error)}</p>
            <button type="button" className={styles.retry} onClick={() => void query.refetch()}>
              Try again
            </button>
          </div>
        )}
        {query.isSuccess && rows.length === 0 && (
          <div className={styles.state}>
            <p>{EMPTY[tab]}</p>
            <Link to={{ pathname: '/book', search }} className={styles.cta}>
              Book a service
            </Link>
          </div>
        )}
        {query.isSuccess && rows.length > 0 && (
          <ul className={styles.list} aria-label={TABS.find((t) => t.id === tab)?.label}>
            {rows.map((a) => {
              const state = displayStatus(a);
              return (
                <li key={a.reference}>
                  <Link
                    to={{ pathname: `/appointments/${a.reference}`, search }}
                    className={styles.row}
                    aria-label={`${a.serviceType.name}, ${dateShort(a.localDate)} ${a.startTime}, ${STATUS_LABEL[state]}`}
                  >
                    <span className={styles.when}>
                      <span className={styles.date}>{dateShort(a.localDate)}</span>
                      <span className={styles.time}>{`${a.startTime}–${a.endTime}`}</span>
                    </span>
                    <span className={styles.what}>
                      <span className={styles.service}>
                        {a.serviceType.name}
                        {a.channel === 'SAME_DAY' && <span className={styles.express}>Express</span>}
                      </span>
                      <span className={styles.sub}>{a.dealership.name}</span>
                    </span>
                    <span className={styles.vehicle}>
                      <span>{`${a.vehicle.modelYear} ${a.vehicle.modelName}`}</span>
                      <span className={styles.plate}>{a.vehicle.plate ?? 'No plate'}</span>
                    </span>
                    <span className={`${styles.status} ${styles[`s_${state}`]}`}>{STATUS_LABEL[state]}</span>
                    <span className={styles.ref} title="Booking number">
                      {a.reference}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
