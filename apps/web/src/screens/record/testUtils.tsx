import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configure, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { store } from '../../mocks/store.js';
import type { MockAppointment } from '../../mocks/store.js';

// The full verify run executes API integration tests in parallel; give async queries headroom.
configure({ asyncUtilTimeout: 5000 });

/** Thursday 2026-10-08, 09:10 in Asia/Ho_Chi_Minh. Only `Date` is faked so timers keep working. */
export function freezeClock(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-08T02:10:00Z'));
}

export function renderAt(ui: ReactElement, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

let seq = 100;
/** Adds an appointment to the mock store, cloned from the fixture with overrides. */
export function addAppointment(over: Partial<MockAppointment> = {}): MockAppointment {
  const base = store.appointments[0]!;
  const n = seq++;
  const a: MockAppointment = {
    ...base,
    reference: `APT-20261008-${String(n).padStart(4, '0')}`,
    history: [...base.history],
    parts: [],
    ...over,
  };
  store.appointments.push(a);
  return a;
}
