import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addAppointment, freezeClock, renderAt } from '../record/testUtils.js';
import { BoardScreen } from './index.js';

beforeEach(freezeClock); // Thu 2026-10-08 09:10 local
afterEach(() => vi.useRealTimers());

describe('Service board', () => {
  it('places blocks by start/end and tags express and no-show jobs', async () => {
    addAppointment({ startMin: 8 * 60 + 30, endMin: 9 * 60 + 15, serviceTypeCode: 'OIL_CHANGE', bayId: 'BAY-01', technicianId: 'TEC-02', channel: 'SAME_DAY' });
    addAppointment({ startMin: 11 * 60, endMin: 11 * 60 + 30, serviceTypeCode: 'GENERAL_INSPECTION', bayId: 'BAY-01', technicianId: 'TEC-04' });
    addAppointment({ startMin: 11 * 60 + 30, endMin: 12 * 60 + 15, serviceTypeCode: 'TIRE_ROTATION', bayId: 'BAY-01', technicianId: 'TEC-04' });
    const ns = addAppointment({ startMin: 9 * 60 + 30, endMin: 10 * 60, serviceTypeCode: 'AIR_FILTER_REPLACEMENT', bayId: 'BAY-03', technicianId: 'TEC-01', status: 'NO_SHOW' });
    renderAt(<BoardScreen />, '/board');

    expect(await screen.findByRole('heading', { level: 1, name: 'Service board' })).toBeInTheDocument();
    expect(await screen.findByText(/Bays and technicians for Thursday 8 October, 08:00–17:00/)).toBeInTheDocument();
    expect(await screen.findByText('SERVICE BAYS')).toBeInTheDocument();
    expect(screen.getByText('TECHNICIANS')).toBeInTheDocument();

    const bay1 = await screen.findByRole('group', { name: 'Bay 1, General lift' });
    const blocks = Array.from(bay1.querySelectorAll<HTMLElement>('[data-reference]'));
    expect(blocks).toHaveLength(3);
    // 08:30–09:15 (45 min) -> grid lines 3..5; 11:00–11:30 -> 8..9; 11:30–12:15 -> 9..11 (back-to-back).
    const cols = blocks.map((b) => b.style.gridColumn);
    expect(cols).toEqual(['3 / 5', '8 / 9', '9 / 11']);

    const express = within(bay1).getByRole('link', { name: /Oil and filter change, 08:30–09:15, confirmed, express/ });
    expect(express).toHaveTextContent('· Oil and filter change');
    expect(within(express.closest<HTMLElement>('[data-reference]')!).getByText('Express')).toBeInTheDocument();
    expect(express).toHaveAttribute('href', expect.stringMatching(/^\/appointments\/APT-20261008-\d{4}$/));

    // Fixture 0409 (Bay 2, 13:00–15:00) is today and unchecked: it has a Check in button.
    expect(screen.getAllByRole('button', { name: /^Check in 0409/ }).length).toBeGreaterThan(0);

    // No-show: struck through (class), and never offers Check in.
    const noShow = document.querySelector(`[data-reference="${ns.reference}"]`)!;
    expect(noShow.className).toMatch(/noShow/);
    expect(within(noShow as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
  });

  it('check in shows the LATE_ARRIVAL problem for a same-day job past its grace period', async () => {
    const user = userEvent.setup();
    // Started 08:00, grace 15 min, now 09:10.
    const late = addAppointment({
      startMin: 8 * 60,
      endMin: 8 * 60 + 30,
      serviceTypeCode: 'GENERAL_INSPECTION',
      bayId: 'BAY-01',
      technicianId: 'TEC-04',
      channel: 'SAME_DAY',
    });
    renderAt(<BoardScreen />, '/board');
    const short = late.reference.slice(-4);
    // Each job shows on its bay row and its technician row; either button works.
    await user.click((await screen.findAllByRole('button', { name: new RegExp(`^Check in ${short}`) }))[0]!);

    const status = await screen.findByText(/arrived more than 15 minutes late/i);
    expect(status.closest('[role="status"]')).toHaveTextContent('LATE_ARRIVAL');
    // The board refreshes: the job is now a no-show and no longer offers Check in.
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: new RegExp(`^Check in ${short}`) })).not.toBeInTheDocument());
  });

  it('check in succeeds on time and reports it', async () => {
    const user = userEvent.setup();
    renderAt(<BoardScreen />, '/board');
    await user.click((await screen.findAllByRole('button', { name: /^Check in 0409/ }))[0]!);
    expect(await screen.findByText('Checked in 0409 · Brake pad replacement.')).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: /^Check in 0409/ })).not.toBeInTheDocument());
  });

  it('day navigation moves the date and hides Check in on other days', async () => {
    const user = userEvent.setup();
    renderAt(<BoardScreen />, '/board');
    await screen.findAllByRole('button', { name: /^Check in 0409/ });
    await user.click(screen.getByRole('button', { name: 'Next day' }));
    expect(await screen.findByText(/Bays and technicians for Friday 9 October/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Check in/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(await screen.findByText(/Thursday 8 October/)).toBeInTheDocument();
  });
});
