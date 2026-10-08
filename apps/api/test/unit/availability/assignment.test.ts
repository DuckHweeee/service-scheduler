import { describe, expect, it } from 'vitest';
import { pickBay, pickTechnician } from '../../../src/domain/availability/assignment.js';
import { findAlternatives } from '../../../src/domain/availability/index.js';
import { makeDlr01Day, SERVICES } from './fixtures.js';

describe('assignment ordering is independent of input order', () => {
  const day = makeDlr01Day();
  it('technician: tie on skills and busy resolves by id regardless of order', () => {
    const t = day.technicians.filter((x) => x.id !== 'TEC-01');
    expect(pickTechnician(t).id).toBe('TEC-02');
    expect(pickTechnician([...t].reverse()).id).toBe('TEC-02');
  });
  it('bay: type preference then id regardless of order', () => {
    const b = day.bays.filter((x) => x.bayType !== 'WASH_BAY' && x.bayType !== 'EV_ISOLATED');
    expect(pickBay([...b].reverse(), SERVICES.OIL_CHANGE).id).toBe('BAY-01');
    expect(pickBay(b, SERVICES.OIL_CHANGE).id).toBe('BAY-01');
  });
});

describe('findAlternatives exhaustion', () => {
  it('returns fewer than limit when the supplied days run out', () => {
    const out = findAlternatives([{ date: '2026-10-08', day: makeDlr01Day() }], SERVICES.OIL_CHANGE, {
      date: '2026-10-08',
      start: 15 * 60,
    });
    expect(out.map((o) => o.slot.start)).toEqual([15 * 60 + 30, 16 * 60]);
  });
});
