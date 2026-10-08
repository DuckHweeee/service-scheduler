import { fmtMin, parseMin } from '../../lib/time.js';

/** One grid column per half hour. */
export const SLOT_MIN = 30;
/** Grid line of the first time column (column 1 holds the row headers). */
export const FIRST_COL = 2;

/** Number of half-hour columns between opening and closing (08:00–17:00 → 18). */
export function columnCount(opensAt: string, closesAt: string): number {
  return Math.max(1, Math.ceil((parseMin(closesAt) - parseMin(opensAt)) / SLOT_MIN));
}

export interface Placement {
  /** CSS grid-column start line (1-based, includes the header column). */
  colStart: number;
  /** CSS grid-column end line (exclusive). */
  colEnd: number;
}

/**
 * Maps a block's exact start/end onto grid lines. The start snaps down and the end snaps up to the half-hour
 * boundary, so a 45-minute job spans to the next column boundary while its label keeps the exact times.
 */
export function placeBlock(startTime: string, endTime: string, opensAt: string, closesAt: string): Placement {
  const cols = columnCount(opensAt, closesAt);
  const opens = parseMin(opensAt);
  const startIdx = Math.max(0, Math.floor((parseMin(startTime) - opens) / SLOT_MIN));
  const endIdx = Math.min(cols, Math.ceil((parseMin(endTime) - opens) / SLOT_MIN));
  const colStart = FIRST_COL + Math.min(startIdx, cols - 1);
  return { colStart, colEnd: Math.max(FIRST_COL + endIdx, colStart + 1) };
}

export interface HourMark {
  label: string;
  colStart: number;
  colEnd: number;
}

/** Hour labels (each spans two half-hour columns) from opening to closing. */
export function hourMarks(opensAt: string, closesAt: string): HourMark[] {
  const cols = columnCount(opensAt, closesAt);
  const opens = parseMin(opensAt);
  const marks: HourMark[] = [];
  for (let m = 0; m < cols * SLOT_MIN; m += 60) {
    const idx = m / SLOT_MIN;
    marks.push({
      label: fmtMin(opens + m),
      colStart: FIRST_COL + idx,
      colEnd: Math.min(FIRST_COL + idx + 2, FIRST_COL + cols),
    });
  }
  return marks;
}

/** Last four digits of `APT-20261008-0409`. */
export const shortRef = (reference: string): string => reference.slice(-4);
