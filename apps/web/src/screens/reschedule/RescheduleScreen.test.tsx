import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation, useNavigationType } from 'react-router-dom';
import { App } from '../../App.js';
import { addAppointment, freezeClock, renderAt } from '../record/testUtils.js';

beforeEach(freezeClock);
afterEach(() => vi.useRealTimers());

const REF = 'APT-20261008-0409'; // fixture: Thu 8 Oct 13:00-15:00, Bay 2, Riya Patel, brake pads

function renderReschedule(ref = REF, mock?: string) {
  const path = `/appointments/${ref}/reschedule${mock ? `?mock=${mock}` : ''}`;
  window.history.replaceState({}, '', path);
  return renderAt(<App />, path);
}

const slotGroup = () => screen.findByRole('group', { name: 'Start time' });
const enabledSlots = (group: HTMLElement) =>
  within(group)
    .getAllByRole('button')
    .filter((b) => !(b as HTMLButtonElement).disabled);

describe('Reschedule screen', () => {
  it('shows the current slot card and keeps vehicle, service and dealership fixed', async () => {
    renderReschedule();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Reschedule Brake pad replacement' }),
    ).toBeInTheDocument();
    expect(screen.getByText(`Booking number ${REF}`)).toBeInTheDocument();
    const current = screen.getByRole('heading', { name: 'Current' }).closest('section')!;
    expect(within(current).getByText('Thursday 8 October')).toBeInTheDocument();
    expect(within(current).getByText('13:00–15:00')).toBeInTheDocument();
    expect(within(current).getByText('Bay 2')).toBeInTheDocument();
    expect(within(current).getByText('Riya Patel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Vehicle' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Service' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Dealership' })).not.toBeInTheDocument();
  });

  it('marks the current slot "Current" and disabled; nothing is auto-selected', async () => {
    const a = addAppointment({ date: '2026-10-09', startMin: 10 * 60, endMin: 12 * 60 });
    renderReschedule(a.reference);
    const group = await slotGroup();
    const current = await within(group).findByRole('button', { name: '10:00 to 12:00, Current' });
    expect(current).toBeDisabled();
    expect(current).toHaveAttribute('aria-pressed', 'false');
    await waitFor(() => expect(enabledSlots(group).length).toBeGreaterThan(0));
    expect(within(group).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  });

  it('moves the appointment: returns to the record with the notice and the "Rescheduled from" history line', async () => {
    const user = userEvent.setup();
    renderReschedule();
    // Today is not bookable for brake pads, so go to Fri 9 Oct.
    await user.click(await screen.findByRole('button', { name: /^Fri 9 Oct/ }));
    const group = await slotGroup();
    await waitFor(() => expect(enabledSlots(group).length).toBeGreaterThan(0));
    const startTime = enabledSlots(group)[0]!.getAttribute('aria-label')!.slice(0, 5);
    await user.click(enabledSlots(group)[0]!);

    await user.click(screen.getByRole('button', { name: 'Move appointment' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Brake pad replacement' })).toBeInTheDocument();
    expect(screen.getByText(`Appointment moved to Fri 9 Oct ${startTime}.`)).toBeInTheDocument();
    const history = screen.getByRole('heading', { name: 'How it was booked' }).closest('section')!;
    const last = within(history).getAllByRole('listitem').at(-1)!;
    expect(last.textContent).toMatch(/Rescheduled from Thu 8 Oct 13:00 to Fri 9 Oct \d\d:\d\d — Bay \d, .+/);
    expect(screen.getAllByText(/Friday 9 October 2026/).length).toBeGreaterThan(0);
  });

  it('409 shows alternatives; picking one resubmits and succeeds', async () => {
    const user = userEvent.setup();
    renderReschedule(REF, 'conflict');
    await user.click(await screen.findByRole('button', { name: /^Fri 9 Oct/ }));
    const group = await slotGroup();
    await waitFor(() => expect(enabledSlots(group).length).toBeGreaterThan(0));
    await user.click(enabledSlots(group)[0]!);
    await user.click(screen.getByRole('button', { name: 'Move appointment' }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Someone just booked that time.')).toBeInTheDocument();
    const alts = within(alert).getAllByRole('button');
    expect(alts.length).toBeGreaterThan(0);
    await user.click(alts[0]!);
    expect(screen.queryByText('Someone just booked that time.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move appointment' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Move appointment' }));
    expect(await screen.findByText(/^Appointment moved to .+ \d\d:\d\d\.$/)).toBeInTheDocument();
  });

  it('explains when the appointment can no longer be rescheduled', async () => {
    const a = addAppointment({ status: 'CANCELLED', cancelledAtMs: Date.now() });
    renderReschedule(a.reference);
    expect(await screen.findByRole('alert')).toHaveTextContent(/This appointment can't be moved/);
    expect(screen.getByRole('link', { name: 'Back to your appointment' })).toHaveAttribute(
      'href',
      `/appointments/${a.reference}`,
    );
  });
});

function Probe() {
  const loc = useLocation();
  const type = useNavigationType();
  return <output data-testid="probe">{`${type}|${loc.pathname}|${JSON.stringify(loc.state)}`}</output>;
}

describe('W6-F5 reschedule findings', () => {
  it('F5-1 starts with nothing selected: summary says "Pick a new time" and Move appointment is disabled until a pick', async () => {
    const user = userEvent.setup();
    renderReschedule();
    await user.click(await screen.findByRole('button', { name: /^Fri 9 Oct/ }));
    const group = await slotGroup();
    await waitFor(() => expect(enabledSlots(group).length).toBeGreaterThan(0));
    expect(within(group).queryAllByRole('button', { pressed: true })).toHaveLength(0);
    expect(screen.getByText(/Pick a new time$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move appointment' })).toBeDisabled();
    await user.click(enabledSlots(group)[0]!);
    expect(screen.getByRole('button', { name: 'Move appointment' })).toBeEnabled();
  });

  it('F5-2 success replaces the history entry and the notice is shown only once', async () => {
    const user = userEvent.setup();
    renderAt(
      <>
        <Probe />
        <App />
      </>,
      `/appointments/${REF}/reschedule`,
    );
    await user.click(await screen.findByRole('button', { name: /^Fri 9 Oct/ }));
    const group = await slotGroup();
    await waitFor(() => expect(enabledSlots(group).length).toBeGreaterThan(0));
    await user.click(enabledSlots(group)[0]!);
    await user.click(screen.getByRole('button', { name: 'Move appointment' }));
    expect(await screen.findByText(/^Appointment moved to /)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe(`REPLACE|/appointments/${REF}|null`));
    expect(screen.getByText(/^Appointment moved to /)).toBeInTheDocument();
  });

  it('F5-4 parts-unavailable panel does not suggest another dealership', async () => {
    const user = userEvent.setup();
    const a = addAppointment({ date: '2026-10-09', startMin: 10 * 60, endMin: 10 * 60 + 45, serviceTypeCode: 'OIL_CHANGE' });
    renderReschedule(a.reference, 'morning,parts');
    await user.click(await screen.findByRole('button', { name: /^Today, Thu 8 Oct/ }));
    const panel = await screen.findByText(/We don't have the parts for this service at/);
    expect(panel).toHaveTextContent('Try another day.');
    expect(panel).not.toHaveTextContent(/another dealership/);
  });
});
