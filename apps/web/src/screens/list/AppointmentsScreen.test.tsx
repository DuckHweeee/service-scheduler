import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../../mocks/store.js';
import { addAppointment, freezeClock, renderAt } from '../record/testUtils.js';
import { AppointmentsScreen } from './index.js';

beforeEach(() => {
  freezeClock(); // 2026-10-08 09:10 local
  // Fixture: today 13:00 (upcoming). Add a past, a future, a cancelled and a no-show appointment.
  addAppointment({ date: '2026-10-01', startMin: 9 * 60, endMin: 9 * 60 + 45, serviceTypeCode: 'OIL_CHANGE' });
  addAppointment({ date: '2026-10-12', startMin: 10 * 60, endMin: 10 * 60 + 30, serviceTypeCode: 'GENERAL_INSPECTION' });
  addAppointment({ date: '2026-10-13', startMin: 10 * 60, endMin: 11 * 60, serviceTypeCode: 'WHEEL_ALIGNMENT', status: 'CANCELLED' });
  addAppointment({ date: '2026-10-06', startMin: 10 * 60, endMin: 10 * 60 + 30, serviceTypeCode: 'AIR_FILTER_REPLACEMENT', status: 'NO_SHOW', channel: 'SAME_DAY' });
});
afterEach(() => vi.useRealTimers());

const rows = () => within(screen.getByRole('tabpanel')).getAllByRole('link');

describe('My appointments', () => {
  it('filters rows by tab and links each row to its record', async () => {
    const user = userEvent.setup();
    renderAt(<AppointmentsScreen />, '/appointments');

    await screen.findByRole('link', { name: /Brake pad replacement/ });
    expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveAttribute('aria-selected', 'true');
    // Soonest first: today's brake job, then the 12 Oct inspection.
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'Brake pad replacement, Thu 8 Oct 13:00, Confirmed',
      'General inspection, Mon 12 Oct 10:00, Confirmed',
    ]);
    expect(rows()[0]).toHaveAttribute('href', '/appointments/APT-20261008-0409');

    await user.click(screen.getByRole('tab', { name: /^Past/ }));
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual(['Oil and filter change, Thu 1 Oct 09:00, Confirmed']);

    await user.click(screen.getByRole('tab', { name: /Cancelled/ }));
    expect(rows().map((r) => r.getAttribute('aria-label'))).toEqual([
      'Wheel alignment, Tue 13 Oct 10:00, Cancelled',
      'Air filter replacement, Tue 6 Oct 10:00, No-show',
    ]);
  });

  it('shows an empty state with a Book a service CTA', async () => {
    store.appointments.splice(0, store.appointments.length);
    renderAt(<AppointmentsScreen />, '/appointments');
    expect(await screen.findByText('No upcoming appointments.')).toBeInTheDocument();
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('link', { name: 'Book a service' })).toHaveAttribute('href', '/book');
  });
});
