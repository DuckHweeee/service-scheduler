import type { BoardBlock, BoardResponse } from '@scheduler/contracts';
import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client.js';
import { useBoard, useCheckIn, useDealerships } from '../../api/hooks.js';
import { addDays, dateLong, todayIn, weekdayName } from '../../lib/time.js';
import { BAY_TYPE_LABEL } from '../book/labels.js';
import styles from './Board.module.css';
import { FIRST_COL, columnCount, hourMarks, placeBlock, shortRef } from './layout.js';

const SKILL_SHORT: Record<string, string> = {
  GENERAL: 'General',
  BRAKES: 'Brakes',
  ALIGNMENT: 'Alignment',
  EV_HIGH_VOLTAGE: 'EV HV',
};

const skillsText = (skills: string[]) =>
  skills
    .map((s) => SKILL_SHORT[s] ?? s)
    .sort()
    .join(' · ');

interface BlockProps {
  block: BoardBlock;
  row: number;
  board: BoardResponse;
  search: string;
  today: boolean;
  checking: boolean;
  onCheckIn: (reference: string) => void;
}

function Block({ block, row, board, search, today, checking, onCheckIn }: BlockProps) {
  const { colStart, colEnd } = placeBlock(block.startTime, block.endTime, board.opensAt, board.closesAt);
  const short = shortRef(block.reference);
  const noShow = block.status === 'NO_SHOW';
  const checkedIn = block.checkedInAt !== null;
  const express = block.channel === 'SAME_DAY';
  const canCheckIn = today && block.status === 'CONFIRMED' && !checkedIn;
  const range = `${block.startTime}–${block.endTime}`;
  const span = colEnd - colStart;
  const cls = [styles.block, noShow && styles.noShow, checkedIn && styles.checkedIn, express && styles.expressBlock, span < 2 && styles.narrow]
    .filter(Boolean)
    .join(' ');
  const state = noShow ? 'no-show' : checkedIn ? 'checked in' : 'confirmed';
  // One-column blocks (30 min) only have room for one chip: the Check in action wins, the stripe marks Express.
  const showTag = express && (span >= 2 || !canCheckIn);

  return (
    <div
      className={cls}
      style={{ gridRow: row, gridColumn: `${colStart} / ${colEnd}` } as CSSProperties}
      data-reference={block.reference}
    >
      <Link
        to={{ pathname: `/appointments/${block.reference}`, search }}
        className={styles.blockLink}
        title={`${block.reference} · ${block.serviceTypeName} · ${range}${express ? ' · Express' : ''}`}
        aria-label={`${short} ${block.serviceTypeName}, ${range}, ${state}${express ? ', express' : ''}`}
      >
        <span className={styles.blockText}>{span < 2 ? short : `${short} · ${block.serviceTypeName}`}</span>
      </Link>
      {(showTag || canCheckIn) && (
        <div className={styles.blockActions}>
          {showTag && <span className={styles.tag}>Express</span>}
          {canCheckIn && (
            <button
              type="button"
              className={styles.checkIn}
              disabled={checking}
              aria-label={`Check in ${short} ${block.serviceTypeName}`}
              onClick={() => onCheckIn(block.reference)}
            >
              {checking ? '…' : 'Check in'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Timeline({
  board,
  today,
  search,
  checkingRef,
  onCheckIn,
}: {
  board: BoardResponse;
  today: boolean;
  search: string;
  checkingRef: string | null;
  onCheckIn: (reference: string) => void;
}) {
  const cols = columnCount(board.opensAt, board.closesAt);
  const lastCol = FIRST_COL + cols;
  const bayCount = board.bays.length;
  const techCount = board.technicians.length;
  const bayLabelRow = 2;
  const techLabelRow = bayLabelRow + bayCount + 1;

  const grid: CSSProperties = {
    minWidth: `calc(var(--head-w) + ${cols * 52 + 20}px)`,
    gridTemplateColumns: `var(--head-w) repeat(${cols}, minmax(52px, 1fr))`,
    gridTemplateRows: `38px 36px repeat(${bayCount}, 58px) 36px repeat(${techCount}, 58px)`,
  };

  const renderRow = (
    key: string,
    row: number,
    name: string,
    sub: string,
    blocks: BoardBlock[],
  ) => (
    <div key={key} className={styles.contents} role="group" aria-label={`${name}, ${sub}`}>
      <div className={styles.rowHead} style={{ gridRow: row, gridColumn: 1 }}>
        <span className={styles.rowName}>{name}</span>
        <span className={styles.rowSub}>{sub}</span>
      </div>
      <div className={styles.track} style={{ gridRow: row, gridColumn: `2 / ${lastCol}`, backgroundSize: `calc(100% / ${cols}) 100%` }} />
      {blocks.map((b) => (
        <Block
          key={b.reference}
          block={b}
          row={row}
          board={board}
          search={search}
          today={today}
          checking={checkingRef === b.reference}
          onCheckIn={onCheckIn}
        />
      ))}
    </div>
  );

  return (
    <section aria-label="Bay and technician timeline" className={styles.timeline}>
      <div className={styles.scroll} tabIndex={0} role="region" aria-label="Timeline, scrolls horizontally">
        <div className={styles.grid} style={grid}>
          {hourMarks(board.opensAt, board.closesAt).map((m) => (
            <span
              key={m.label}
              className={styles.hour}
              style={{ gridRow: 1, gridColumn: `${m.colStart} / ${m.colEnd}` }}
            >
              {m.label}
            </span>
          ))}
          <span className={styles.section} style={{ gridRow: bayLabelRow, gridColumn: 1 }}>
            SERVICE BAYS
          </span>
          {board.bays.map((b, i) =>
            renderRow(b.id, bayLabelRow + 1 + i, b.name, BAY_TYPE_LABEL[b.bayType], b.blocks),
          )}
          <span className={styles.section} style={{ gridRow: techLabelRow, gridColumn: 1 }}>
            TECHNICIANS
          </span>
          {board.technicians.map((t, i) =>
            renderRow(t.id, techLabelRow + 1 + i, t.name, skillsText(t.skills), t.blocks),
          )}
        </div>
      </div>
    </section>
  );
}

export function BoardScreen() {
  const { search } = useLocation();
  const dealerships = useDealerships();
  const [dealershipId, setDealershipId] = useState('DLR-01');
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  const dealership = dealerships.data?.items.find((d) => d.id === dealershipId);
  const tz = dealership?.timezone ?? 'Asia/Ho_Chi_Minh';
  const today = todayIn(tz);
  const date = pickedDate ?? today;

  const board = useBoard(dealershipId, date, dealerships.isSuccess);
  const checkIn = useCheckIn();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string; code?: string } | null>(null);

  const doCheckIn = (reference: string) => {
    setMessage(null);
    checkIn.mutate(reference, {
      onSuccess: (a) => setMessage({ kind: 'ok', text: `Checked in ${shortRef(a.reference)} · ${a.serviceType.name}.` }),
      onError: (err) =>
        setMessage({
          kind: 'error',
          text: errorMessage(err),
          code: err instanceof ApiError ? err.problem.code : undefined,
        }),
    });
  };

  const data = board.data;
  const opens = data?.opensAt ?? dealership?.opensAt ?? '08:00';
  const closes = data?.closesAt ?? dealership?.closesAt ?? '17:00';
  const day = weekdayName(date);
  const isToday = date === today;

  return (
    <main className={styles.main}>
      <div className={styles.head}>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>{(data?.dealership.name ?? dealership?.name ?? '').toUpperCase()}</p>
          <h1 className={styles.h1}>Service board</h1>
          <p className={styles.lede}>
            {`Bays and technicians for ${dateLong(date)}, ${opens}–${closes}`}
            {isToday && <span className={styles.todayTag}>Today</span>}
          </p>
        </div>
        <div className={styles.controls}>
          <label className={styles.selectLabel}>
            <span className={styles.srOnly}>Dealership</span>
            <select
              className={styles.select}
              value={dealershipId}
              onChange={(e) => {
                setDealershipId(e.target.value);
                setMessage(null);
              }}
            >
              {(dealerships.data?.items ?? [{ id: dealershipId, name: dealershipId }]).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.dayNav}>
          <button type="button" aria-label="Previous day" className={styles.iconBtn} onClick={() => setPickedDate(addDays(date, -1))}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button type="button" className={styles.todayBtn} onClick={() => setPickedDate(null)}>
            Today
          </button>
          <button type="button" aria-label="Next day" className={styles.iconBtn} onClick={() => setPickedDate(addDays(date, 1))}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          </div>
        </div>
      </div>

      <div role="status" aria-live="polite" className={message ? (message.kind === 'ok' ? styles.msgOk : styles.msgErr) : styles.srOnly}>
        {message && (
          <>
            {message.code && <span className={styles.msgCode}>{message.code}</span>}
            {message.text}
          </>
        )}
      </div>

      {(dealerships.isPending || board.isPending) && !board.isError && !dealerships.isError && (
        <p role="status" className={styles.state}>
          Loading board…
        </p>
      )}
      {(board.isError || dealerships.isError) && (
        <div role="alert" className={styles.state}>
          <p>{errorMessage(board.error ?? dealerships.error)}</p>
          <button
            type="button"
            className={styles.retry}
            onClick={() => void (dealerships.isError ? dealerships.refetch() : board.refetch())}
          >
            Try again
          </button>
        </div>
      )}
      {data && !data.isWorkingDay && (
        <p className={styles.closed}>{`${data.dealership.name} is closed on ${day}. Pick another day.`}</p>
      )}
      {data && data.isWorkingDay && (
        <Timeline
          board={data}
          today={isToday}
          search={search}
          checkingRef={checkIn.isPending ? (checkIn.variables ?? null) : null}
          onCheckIn={doCheckIn}
        />
      )}

      <div className={styles.legend}>
        <span>
          <i className={styles.swBooked} aria-hidden="true" />
          Booked
        </span>
        <span>
          <i className={styles.swIn} aria-hidden="true" />
          Checked in
        </span>
        <span>
          <i className={styles.swExpress} aria-hidden="true" />
          Express (same-day)
        </span>
        <span>
          <i className={styles.swNoShow} aria-hidden="true" />
          No-show (released)
        </span>
      </div>
    </main>
  );
}
