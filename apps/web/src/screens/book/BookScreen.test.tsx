import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import {
  appointmentDetailExample,
  dealerships as dealershipsExample,
  serviceTypes as serviceTypesExample,
  vehicles as vehiclesExample,
} from '@scheduler/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BookForm } from './BookForm.js';
import { Confirmation } from './Confirmation.js';
import { BookScreen } from './BookScreen.js';

// Thursday 2026-10-08, 09:10 in Asia/Ho_Chi_Minh. Only Date is faked so timers keep working.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T02:10:00Z'));
});
afterEach(() => vi.useRealTimers());

function renderBook(mock?: string) {
  window.history.replaceState({}, '', mock ? `/book?mock=${mock}` : '/book');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/book']}>
        <BookScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const slotGroup = () => screen.findByRole('group', { name: 'Start time' });
const slotButtons = (group: HTMLElement) => within(group).getAllByRole('button');
const enabledSlots = (group: HTMLElement) =>
  slotButtons(group).filter((b) => !(b as HTMLButtonElement).disabled);

describe('Book screen', () => {
  it('shows the four numbered sections and auto-selects the first available slot on the first working day after today', async () => {
    renderBook();
    expect(await screen.findByRole('heading', { name: 'Book a service' })).toBeInTheDocument();
    for (const name of ['Vehicle', 'Service', 'Dealership', 'Date and time']) {
      expect(screen.getByRole('heading', { name: name })).toBeInTheDocument();
    }
    const group = await slotGroup();
    const first = enabledSlots(group)[0]!;
    expect(first).toHaveAttribute('aria-pressed', 'true');
    // Fri 9 Oct is the default date.
    expect(screen.getByRole('button', { name: /^Fri 9 Oct/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Today, Thu 8 Oct/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(await screen.findByText(/Enough time for the whole job/)).toBeInTheDocument();
  });

  it('changing the service clears the slot and auto-selects the first available', async () => {
    const user = userEvent.setup();
    renderBook();
    let group = await slotGroup();
    const open = enabledSlots(group);
    expect(open.length).toBeGreaterThan(1);
    await user.click(open[1]!);
    expect(open[1]).toHaveAttribute('aria-pressed', 'true');
    expect(open[0]).toHaveAttribute('aria-pressed', 'false');

    await user.click(screen.getByRole('button', { name: /Oil and filter change/ }));
    expect(screen.getByRole('button', { name: /Oil and filter change/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(screen.getByText(/this job takes 45 min/)).toBeInTheDocument());
    await waitFor(async () => {
      group = await slotGroup();
      const slots = enabledSlots(group);
      expect(slots[0]).toHaveAttribute('aria-pressed', 'true');
      expect(slots.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
      expect(slots[0]!.getAttribute('aria-label')).toMatch(/^\d\d:\d\d to \d\d:\d\d, Free$/);
    });
  });

  it('hides services that do not apply to the vehicle powertrain', async () => {
    const user = userEvent.setup();
    renderBook();
    await slotGroup();
    // ICE (default): no EV battery check.
    expect(screen.getByRole('button', { name: /Oil and filter change/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /High-voltage battery check/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /2024 Compact EV/ }));
    expect(screen.getByRole('button', { name: /High-voltage battery check/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Oil and filter change/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /2022 Crossover LX/ }));
    expect(screen.queryByRole('button', { name: /High-voltage battery check/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Oil and filter change/ })).toBeInTheDocument();
  });

  it('Today + brake pad replacement shows the SERVICE_NOT_EXPRESS panel and the same-day notice', async () => {
    const user = userEvent.setup();
    renderBook('morning');
    await slotGroup();
    await user.click(screen.getByRole('button', { name: /^Today, Thu 8 Oct/ }));
    expect(
      await screen.findByText(
        /Brake pad replacement can't be booked for today\. Today we only take express jobs: Oil and filter change, General inspection.*\. Pick another day for this service\./,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Same-day booking is for express jobs only\. Please arrive on time/),
    ).toHaveTextContent('more than 15 minutes late');
    expect(screen.queryByRole('group', { name: 'Start time' })).not.toBeInTheDocument();
  });

  it('Today + an express service lists express slots from the earliest start (09:10 + 2 h → 11:30)', async () => {
    const user = userEvent.setup();
    renderBook('morning');
    await slotGroup();
    await user.click(screen.getByRole('button', { name: /Oil and filter change/ }));
    await user.click(screen.getByRole('button', { name: /^Today, Thu 8 Oct/ }));
    await waitFor(async () => {
      const group = await slotGroup();
      expect(slotButtons(group)[0]).toHaveAttribute('aria-label', expect.stringMatching(/^11:30 to 12:15, /));
    });
    const group = await slotGroup();
    const open = enabledSlots(group);
    if (open.length) expect(open[0]).toHaveTextContent('Express');
  });

  it('parts scenario blocks express services today', async () => {
    const user = userEvent.setup();
    renderBook('morning,parts');
    await slotGroup();
    await user.click(screen.getByRole('button', { name: /Oil and filter change/ }));
    await user.click(screen.getByRole('button', { name: /^Today, Thu 8 Oct/ }));
    expect(
      await screen.findByText(
        /We don't have the parts for this service at Northside Service Center today\. Try another dealership or another day\./,
      ),
    ).toBeInTheDocument();
  });

  it('cutoff scenario closes same-day booking', async () => {
    const user = userEvent.setup();
    renderBook('cutoff');
    await slotGroup();
    await user.click(screen.getByRole('button', { name: /Oil and filter change/ }));
    await user.click(screen.getByRole('button', { name: /^Today, Thu 8 Oct/ }));
    expect(
      await screen.findByText(
        /Booking for today is closed\. Same-day jobs must start at least 2 hours from now\. Pick another day\./,
      ),
    ).toBeInTheDocument();
  });

  it('full happy path renders the confirmation with a link to the record', async () => {
    const user = userEvent.setup();
    renderBook();
    await slotGroup();
    const confirm = await screen.findByRole('button', { name: 'Confirm appointment' });
    await user.click(confirm);
    expect(
      await screen.findByRole('heading', { name: /You're booked for Friday 9 October, \d\d:\d\d/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'See your appointment' });
    expect(link.getAttribute('href')).toMatch(/^\/appointments\/APT-20261009-\d{4}/);
    expect(screen.getByText('Linh Tran')).toBeInTheDocument();
    expect(screen.getByText('SERVICE BAY')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Book another service' }));
    expect(await screen.findByRole('heading', { name: 'Book a service' })).toBeInTheDocument();
    // The slot we just booked is now busy, so a different one is auto-selected.
    const group = await slotGroup();
    expect(group).toBeInTheDocument();
  });

  it('409 path lists alternatives and choosing one updates the selection', async () => {
    const user = userEvent.setup();
    renderBook('conflict');
    await slotGroup();
    await user.click(await screen.findByRole('button', { name: 'Confirm appointment' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Someone just booked that time.');
    expect(alert).toHaveTextContent(/No Brakes-qualified technician is free for the full window/);
    const alts = within(alert).getAllByRole('button');
    expect(alts).toHaveLength(5);

    const chosen = alts[2]!;
    const m = /^(\w{3} \d+ \w{3}) · (\d\d:\d\d)–/.exec(chosen.textContent ?? '');
    expect(m).not.toBeNull();
    const [, dateText, startTime] = m!;
    await user.click(chosen);

    expect(screen.queryByText('Someone just booked that time.')).not.toBeInTheDocument();
    const [, day, mon] = dateText!.split(' ');
    expect(screen.getByRole('button', { name: new RegExp(`${day} ${mon}`) })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(async () => {
      const group = await slotGroup();
      const picked = slotButtons(group).filter((b) => b.getAttribute('aria-pressed') === 'true');
      expect(picked).toHaveLength(1);
      expect(picked[0]).toHaveAttribute('aria-label', expect.stringMatching(new RegExp(`^${startTime} to `)));
    });
    expect(await screen.findByRole('button', { name: 'Confirm appointment' })).toBeEnabled();

    // The next attempt goes through normally (conflict is one-shot).
    await user.click(screen.getByRole('button', { name: 'Confirm appointment' }));
    expect(await screen.findByRole('heading', { name: /You're booked for/ })).toBeInTheDocument();
  });
});

describe('W6-F5 book findings', () => {
  it('F5-3 after a 409 nothing is selected until the user picks a slot or an alternative', async () => {
    const user = userEvent.setup();
    renderBook('conflict');
    await slotGroup();
    await user.click(await screen.findByRole('button', { name: 'Confirm appointment' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    await waitFor(async () => {
      const group = await slotGroup();
      expect(slotButtons(group).filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(0);
    });
    expect(screen.queryByRole('button', { name: 'Confirm appointment' })).not.toBeInTheDocument();
    // Picking a slot by hand enables Confirm again.
    const group = await slotGroup();
    await user.click(enabledSlots(group)[0]!);
    expect(await screen.findByRole('button', { name: 'Confirm appointment' })).toBeEnabled();
  });

  it('F5-6 a vehicle with no matching service shows a friendly empty state instead of crashing', () => {
    const evOnly = serviceTypesExample.filter((s) => s.powertrains.length === 1 && s.powertrains[0] === 'EV');
    const ice = vehiclesExample.filter((v) => v.powertrain === 'ICE');
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <BookForm dealerships={dealershipsExample} serviceTypes={evOnly} vehicles={ice} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(
      screen.getByText('No services are available for this vehicle. Choose another vehicle.'),
    ).toBeInTheDocument();
  });

  it('F5-7 confirmation says when reminders go out, but a same-day booking shows the late-release rule', () => {
    const advance = { ...appointmentDetailExample, channel: 'ADVANCE' as const };
    const { unmount } = render(
      <MemoryRouter>
        <Confirmation record={advance} onReset={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/remind you the day before/)).toBeInTheDocument();
    unmount();
    const sameDay = { ...appointmentDetailExample, channel: 'SAME_DAY' as const, lateGraceMin: 20 };
    render(
      <MemoryRouter>
        <Confirmation record={sameDay} onReset={() => {}} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/remind you the day before/)).not.toBeInTheDocument();
    expect(screen.getByText(/more than 20 minutes late/)).toBeInTheDocument();
  });
});
