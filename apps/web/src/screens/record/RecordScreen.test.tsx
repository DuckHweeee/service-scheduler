import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { appointmentDetailExample } from '@scheduler/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.js';
import { RecordScreen } from './index.js';
import { buildIcs } from './ics.js';
import { addAppointment, freezeClock, renderAt } from './testUtils.js';

beforeEach(freezeClock);
afterEach(() => vi.useRealTimers());

const REF = 'APT-20261008-0409';

function renderRecord(ref = REF) {
  return renderAt(
    <Routes>
      <Route path="/appointments/:reference" element={<RecordScreen />} />
    </Routes>,
    `/appointments/${ref}`,
  );
}

describe('Appointment record', () => {
  it('renders the header, linked cards and the booking history in order', async () => {
    renderRecord();
    expect(await screen.findByRole('heading', { level: 1, name: 'Brake pad replacement' })).toBeInTheDocument();
    expect(screen.getByText('Confirmed', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/Thursday 8 October 2026 ·/)).toBeInTheDocument();
    expect(screen.getByText('Brakes ✓ required')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toHaveAttribute('title', 'Coming soon');
    expect(screen.queryByText('Express · same-day')).not.toBeInTheDocument();

    const history = screen.getByRole('heading', { name: 'How it was booked' }).closest('section')!;
    const items = within(history).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      '14:02:09Requested 10:00–12:00',
      '14:02:09Check failed: no Brakes-qualified technician free for the full window. Five alternatives offered.',
      '14:02:41Customer chose 13:00–15:00',
      '14:02:41Check passed: Bay 2 and Riya Patel free 13:00–15:00',
      '14:02:42Bay and technician reserved together',
      '14:02:42Appointment record created · confirmation sent',
    ]);

    const table = screen.getByRole('table');
    for (const name of ['Booked via', 'Time', 'Booked on']) {
      expect(within(table).getByRole('rowheader', { name })).toBeInTheDocument();
    }
    expect(within(table).getByText('Advance booking')).toBeInTheDocument();
    expect(within(table).getByText('Wed 7 Oct 2026, 14:02')).toBeInTheDocument();
    expect(within(table).queryByText('service_bay_id')).not.toBeInTheDocument();
    expect(screen.getByText('Reference IDs (for support)')).toBeInTheDocument();
  });

  it('shows the express tag and late-arrival notice for same-day appointments', async () => {
    const a = addAppointment({ channel: 'SAME_DAY' });
    renderRecord(a.reference);
    expect(await screen.findByText('Express · same-day')).toBeInTheDocument();
    expect(screen.getByText(/more than 15 minutes late/)).toBeInTheDocument();
  });

  it('shows a friendly not-found panel with a link back to My appointments', async () => {
    renderRecord('APT-20260101-9999');
    expect(await screen.findByRole('heading', { name: 'Appointment not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to My appointments' })).toHaveAttribute('href', '/appointments');
  });

  it('cancel dialog: Escape closes it without cancelling', async () => {
    const user = userEvent.setup();
    renderRecord();
    const open = await screen.findByRole('button', { name: 'Cancel appointment' });
    await user.click(open);
    expect(screen.getByRole('dialog', { name: 'Cancel this appointment?' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Reason/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    expect(screen.getByText('Confirmed', { selector: 'span' })).toBeInTheDocument();
  });

  it('cancel dialog: confirming shows the cancelled state', async () => {
    const user = userEvent.setup();
    renderRecord();
    await user.click(await screen.findByRole('button', { name: 'Cancel appointment' }));
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'Change of plans');
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    expect(await screen.findByText('Cancelled', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel appointment' })).not.toBeInTheDocument();
    expect(screen.getByText(/has been cancelled/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(`Appointment ${REF} cancelled.`);
    expect(screen.getByText('Appointment cancelled', { selector: 'span' })).toBeInTheDocument();
  });

  it('cancelling updates the My appointments list without a reload', async () => {
    const user = userEvent.setup();
    renderAt(<App />, `/appointments/${REF}`);
    await user.click(await screen.findByRole('button', { name: 'Cancel appointment' }));
    await user.click(screen.getByRole('button', { name: 'Confirm cancellation' }));
    await screen.findByText(/has been cancelled/);
    await user.click(within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'My appointments' }));
    await user.click(await screen.findByRole('tab', { name: /Cancelled/ }));
    expect(await screen.findByRole('link', { name: /Brake pad replacement.*Cancelled/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Upcoming/ })).toHaveTextContent('0'));
  });
});

describe('buildIcs', () => {
  it('uses the reference as UID and UTC start/end', () => {
    const ics = buildIcs(appointmentDetailExample, Date.UTC(2026, 9, 7, 7, 0, 0));
    expect(ics).toContain('UID:APT-20261008-0409\r\n');
    expect(ics).toContain('DTSTART:20261008T060000Z\r\n');
    expect(ics).toContain('DTEND:20261008T080000Z\r\n');
    expect(ics).toContain('SUMMARY:Brake pad replacement\r\n');
    expect(ics).toContain('LOCATION:Northside Service Center\r\n');
  });
});
