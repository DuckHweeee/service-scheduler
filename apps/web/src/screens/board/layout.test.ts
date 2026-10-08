import { describe, expect, it } from 'vitest';
import { columnCount, hourMarks, placeBlock, shortRef } from './layout.js';

const place = (s: string, e: string) => placeBlock(s, e, '08:00', '17:00');

describe('board layout', () => {
  it('derives 18 half-hour columns from 08:00–17:00', () => {
    expect(columnCount('08:00', '17:00')).toBe(18);
    expect(columnCount('09:00', '13:00')).toBe(8);
  });

  it('places blocks on grid lines (column 1 is the row header)', () => {
    expect(place('08:00', '09:00')).toEqual({ colStart: 2, colEnd: 4 });
    expect(place('13:00', '15:00')).toEqual({ colStart: 12, colEnd: 16 });
    expect(place('16:30', '17:00')).toEqual({ colStart: 19, colEnd: 20 });
  });

  it('a 45-minute job spans to the next column boundary', () => {
    // 08:30–09:15 → starts at 08:30 (col 3), ends inside the 09:00 column so it runs to 09:30 (line 5).
    expect(place('08:30', '09:15')).toEqual({ colStart: 3, colEnd: 5 });
    expect(place('08:00', '08:45')).toEqual({ colStart: 2, colEnd: 4 });
  });

  it('back-to-back blocks share a grid line without overlapping', () => {
    const a = place('11:00', '11:30');
    const b = place('11:30', '12:15');
    expect(a.colEnd).toBe(b.colStart);
    expect(b).toEqual({ colStart: 9, colEnd: 11 });
  });

  it('adapts to other opening hours', () => {
    expect(placeBlock('10:00', '10:30', '09:00', '13:00')).toEqual({ colStart: 4, colEnd: 5 });
  });

  it('builds hour marks of two columns each', () => {
    const marks = hourMarks('08:00', '17:00');
    expect(marks).toHaveLength(9);
    expect(marks[0]).toEqual({ label: '08:00', colStart: 2, colEnd: 4 });
    expect(marks[8]).toEqual({ label: '16:00', colStart: 18, colEnd: 20 });
  });

  it('shortens references to their last four digits', () => {
    expect(shortRef('APT-20261008-0409')).toBe('0409');
  });
});
