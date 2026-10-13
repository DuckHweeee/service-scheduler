import type { AppointmentDetail } from '@scheduler/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client.js';
import { keys, useAppointment, useCancelAppointment } from '../../api/hooks.js';
import { businessNow } from '../../lib/now.js';
import { dateLong, dateTimeShort, durationText } from '../../lib/time.js';
import { BAY_TYPE_LABEL, SKILL_LABEL } from '../book/labels.js';
import { CancelDialog } from './CancelDialog.js';
import styles from './Record.module.css';
import { openGoogleCalendar } from './calendar.js';
import { STATUS_LABEL, displayStatus } from './status.js';

const ICON = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
  'aria-hidden': true,
} as const;

const clock = (iso: string) => iso.slice(11, 19);

function LinkedCard({ label, icon, title, children }: { label: string; icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.cardLabel}>{label}</span>
        <svg {...ICON} width="20" height="20" strokeWidth="1.75" className={styles.cardIcon}>
          {icon}
        </svg>
      </div>
      <div className={styles.cardTitleBox}>
        <h3 className={styles.cardTitle}>{title}</h3>
      </div>
      {children}
    </article>
  );
}

function Record({ a }: { a: AppointmentDetail }) {
  const { search, pathname, state: navState } = useLocation();
  const navigate = useNavigate();
  // The "moved" notice arrives in history state. Keep it in local state and clear the history entry, so Back and
  // reloads do not show it again.
  const [moved] = useState(() => (navState as { notice?: unknown } | null)?.notice);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => noticeRef.current?.focus(), []);
  useEffect(() => {
    if (moved !== undefined) void navigate({ pathname, search }, { replace: true, state: null });
  }, [moved, navigate, pathname, search]);
  const cancel = useCancelAppointment();
  const [dialog, setDialog] = useState(false);
  const [justCancelled, setJustCancelled] = useState(false);
  const qc = useQueryClient();

  const state = displayStatus(a);
  const range = `${a.startTime}–${a.endTime}`;
  const isConfirmed = a.status === 'CONFIRMED';
  const canCancel = isConfirmed && !a.checkedInAt && Date.parse(a.startAt) > businessNow(a.dealership.timezone);
  const sameDay = a.channel === 'SAME_DAY';

  const tz = a.dealership.timezone;
  const vehicle = `${a.vehicle.modelYear} ${a.vehicle.modelName}${a.vehicle.plate ? ` · ${a.vehicle.plate}` : ''}`;
  const fields: [string, string][] = [
    ['Booking number', a.reference],
    ['Status', STATUS_LABEL[state]],
    ['Booked as', sameDay ? 'Same-day express' : 'Advance booking'],
    ['Service', a.serviceType.name],
    ['Date', `${dateLong(a.localDate)} ${a.localDate.slice(0, 4)}`],
    ['Time', `${range} (local time at the dealership)`],
    ['Duration', durationText(a.durationMin)],
    ['Dealership', a.dealership.name],
    ['Service bay', a.serviceBay.name],
    ['Technician', a.technician.name],
    ['Vehicle', vehicle],
    ['Booked on', dateTimeShort(a.createdAt, tz)],
  ];
  if (a.checkedInAt) fields.push(['Checked in', dateTimeShort(a.checkedInAt, tz)]);
  if (a.cancelledAt) fields.push(['Cancelled', dateTimeShort(a.cancelledAt, tz)]);
  const ids: [string, string][] = [
    ['Customer ID', a.customer.id],
    ['Vehicle ID', a.vehicle.id],
    ['Technician ID', a.technician.id],
    ['Bay ID', a.serviceBay.id],
    ['Dealership ID', a.dealership.id],
    ['Service code', a.serviceType.code],
  ];

  const confirmCancel = (reason: string) =>
    cancel.mutate(
      { reference: a.reference, body: reason ? { reason } : {} },
      {
        onSuccess: (updated) => {
          qc.setQueryData(keys.appointment(a.reference), updated);
          setDialog(false);
          setJustCancelled(true);
        },
      },
    );

  return (
    <main className={styles.main}>
      <nav aria-label="Breadcrumb" className={styles.crumbs}>
        <Link to={{ pathname: '/appointments', search }}>My appointments</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page" className={styles.crumbRef}>
          {a.reference}
        </span>
      </nav>

      <div role="status" aria-live="polite" className={styles.srOnly}>
        {justCancelled ? `Appointment ${a.reference} cancelled.` : ''}
      </div>

      <section aria-labelledby="h-appt" className={styles.hero}>
        <div className={styles.heroText}>
          <div className={styles.heroRow}>
            <span className={`${styles.badge} ${styles[`badge_${state}`]}`}>
              {state === 'CANCELLED' || state === 'NO_SHOW' ? (
                <svg {...ICON} width="14" height="14" strokeWidth="3">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg {...ICON} width="14" height="14" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
              {STATUS_LABEL[state]}
            </span>
            <span className={styles.ref}>{`Booking number ${a.reference}`}</span>
            {sameDay && <span className={styles.express}>Express · same-day</span>}
          </div>
          <h1 id="h-appt" className={styles.h1}>
            {a.serviceType.name}
          </h1>
          <p className={styles.heroSub}>
            {`${dateLong(a.localDate)} ${a.localDate.slice(0, 4)} · `}
            <span className={styles.mono}>{range}</span>
            {` · ${a.dealership.name}`}
          </p>
        </div>
        {canCancel && (
          <div className={styles.actions}>
            <button type="button" className={styles.btnPrimary} onClick={() => openGoogleCalendar(a)}>
              Add to calendar
            </button>
            {canCancel && (
              <Link to={{ pathname: `/appointments/${a.reference}/reschedule`, search }} className={styles.btnGhost}>
                Reschedule
              </Link>
            )}
            {canCancel && (
              <button type="button" className={styles.btnDanger} onClick={() => setDialog(true)}>
                Cancel appointment
              </button>
            )}
          </div>
        )}
      </section>

      {typeof moved === 'string' && a.status === 'CONFIRMED' && (
        <p ref={noticeRef} tabIndex={-1} role="status" className={styles.notice}>
          {moved}
        </p>
      )}
      {justCancelled && a.status === 'CANCELLED' && (
        <p className={styles.notice}>This appointment is cancelled. Its time is free for other customers.</p>
      )}
      {sameDay && canCancel && (
        <p className={styles.notice}>
          {`Please arrive on time. If you are more than ${a.lateGraceMin} minutes late, we give your time to someone else.`}
        </p>
      )}

      <section aria-labelledby="h-assoc" className={styles.group}>
        <h2 id="h-assoc" className={styles.groupTitle}>
          WHO AND WHAT IS INVOLVED
        </h2>
        <div className={styles.cards}>
          <LinkedCard
            label="CUSTOMER"
            title={a.customer.fullName}
            icon={
              <>
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
              </>
            }
          >
            <p className={styles.cardText}>{`${a.customer.phone ?? 'No phone'} · ${a.customer.email ?? 'No email'}`}</p>
          </LinkedCard>
          <LinkedCard
            label="VEHICLE"
            title={`${a.vehicle.modelYear} ${a.vehicle.modelName}`}
            icon={
              <>
                <path d="M3 16v-4l2-5h14l2 5v4" />
                <path d="M3 16h18" />
                <circle cx="7" cy="17" r="2" />
                <circle cx="17" cy="17" r="2" />
              </>
            }
          >
            <p className={`${styles.cardText} ${styles.mono}`}>{`Plate ${a.vehicle.plate ?? 'none'} · VIN ends ${a.vehicle.vinLast4}`}</p>
          </LinkedCard>
          <LinkedCard
            label="TECHNICIAN"
            title={a.technician.name}
            icon={<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" />}
          >
            <div className={styles.chips}>
              {a.technician.skills.map((s) => {
                const required = s === a.serviceType.requiredSkill;
                return (
                  <span key={s} className={required ? styles.chipReq : styles.chip}>
                    {required ? `${SKILL_LABEL[s]} ✓ needed for this job` : SKILL_LABEL[s]}
                  </span>
                );
              })}
            </div>
          </LinkedCard>
          <LinkedCard
            label="SERVICE BAY"
            title={a.serviceBay.name}
            icon={
              <>
                <path d="M3 21V9l9-6 9 6v12" />
                <path d="M7 21v-8h10v8" />
                <path d="M7 17h10" />
              </>
            }
          >
            <p className={styles.cardText}>{`${BAY_TYPE_LABEL[a.serviceBay.bayType]} · ${a.dealership.name}`}</p>
          </LinkedCard>
        </div>
      </section>

      {a.parts.length > 0 && (
        <section aria-labelledby="h-parts" className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 id="h-parts" className={styles.h2}>
              Parts reserved
            </h2>
            <span className={styles.panelNote}>Held for this appointment</span>
          </div>
          <ul className={styles.parts}>
            {a.parts.map((p) => (
              <li key={p.sku}>
                <span>{p.name}</span>
                <span className={styles.mono}>{`Part ${p.sku} × ${p.qty}`}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={styles.split}>
        <section aria-labelledby="h-fields" className={styles.fields}>
          <div className={styles.panelHead}>
            <h2 id="h-fields" className={styles.h2}>
              Appointment details
            </h2>
            <span className={styles.panelNote}>The main facts</span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <tbody>
                {fields.map(([k, v]) => (
                  <tr key={k}>
                    <th scope="row">{k}</th>
                    <td className={k === 'Booking number' ? styles.mono : undefined}>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className={styles.ids}>
            <summary>Reference numbers (give these to support)</summary>
            <dl>
              {ids.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className={styles.mono}>{v}</dd>
                </div>
              ))}
            </dl>
          </details>
        </section>

        <section aria-labelledby="h-hist" className={styles.history}>
          <h2 id="h-hist" className={styles.h2}>
            How it was booked
          </h2>
          <ol className={styles.timeline}>
            {a.history.map((h, i) => {
              const last = i === a.history.length - 1;
              return (
                <li key={`${h.type}-${i}`} className={styles.event}>
                  <span className={styles.eventTime}>{clock(h.occurredAt)}</span>
                  <span
                    aria-hidden="true"
                    className={`${styles.dot} ${
                      last ? styles.dotLast : h.type === 'CHECK_FAILED' ? styles.dotFail : h.type === 'CHECK_PASSED' || h.type === 'RESOURCES_RESERVED' ? styles.dotOk : ''
                    }`}
                  />
                  <span className={last ? styles.eventLast : styles.eventText}>{h.summary}</span>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      {dialog && (
        <CancelDialog
          summary={`${a.serviceType.name}, ${dateLong(a.localDate)} ${range}`}
          pending={cancel.isPending}
          error={cancel.isError ? errorMessage(cancel.error) : null}
          onConfirm={confirmCancel}
          onClose={() => {
            cancel.reset();
            setDialog(false);
          }}
        />
      )}
    </main>
  );
}

export function RecordScreen() {
  const { reference = '' } = useParams();
  const { search } = useLocation();
  const query = useAppointment(reference);

  if (query.isPending) {
    return (
      <main className={styles.main} aria-busy="true">
        <p className={styles.loading} role="status">
          Loading appointment…
        </p>
      </main>
    );
  }
  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <main className={styles.main}>
        <section className={styles.empty} aria-labelledby="h-missing">
          <h1 id="h-missing" className={styles.emptyTitle}>
            {notFound ? 'Appointment not found' : "We couldn't open this appointment"}
          </h1>
          <p className={styles.emptyText} role={notFound ? undefined : 'alert'}>
            {notFound
              ? `We couldn't find an appointment with booking number ${reference}. Check the number, or pick the appointment from your list.`
              : errorMessage(query.error)}
          </p>
          <div className={styles.emptyActions}>
            <Link to={{ pathname: '/appointments', search }} className={styles.btnLink}>
              Go to My appointments
            </Link>
            {!notFound && (
              <button type="button" className={styles.btnGhostLight} onClick={() => void query.refetch()}>
                Try again
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }
  return <Record a={query.data} />;
}
