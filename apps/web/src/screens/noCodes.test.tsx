import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.js';
import { server } from '../mocks/server.js';
import { freezeClock, renderAt } from './record/testUtils.js';

beforeEach(freezeClock);
afterEach(() => vi.useRealTimers());

const CODE = /[A-Z]{3,}_[A-Z_]+/;

/** Every API call answers 500 with a technical problem body; screens must not leak its code. */
function breakApi() {
  const body = {
    type: 'about:blank',
    title: 'INTERNAL_ERROR',
    status: 500,
    code: 'INTERNAL_ERROR',
    detail: 'INTERNAL_ERROR: db_down',
  };
  server.use(
    http.all('*', ({ request }) =>
      new URL(request.url).pathname.startsWith('/src') || new URL(request.url).pathname.startsWith('/node_modules')
        ? undefined
        : HttpResponse.json(body, { status: 500, headers: { 'Content-Type': 'application/problem+json' } }),
    ),
  );
}

describe('F5 no raw API codes on screen', () => {
  for (const path of [
    '/book',
    '/appointments',
    '/appointments/APT-20261008-0409',
    '/appointments/APT-20261008-0409/reschedule',
    '/board',
  ]) {
    it(`error state of ${path} shows plain words only`, async () => {
      breakApi();
      renderAt(<App />, path);
      await screen.findAllByRole('alert', {}, { timeout: 9000 });
      expect(document.body.textContent).not.toMatch(CODE);
    }, 20000);
  }

  it('the not-found state shows plain words only', async () => {
    renderAt(<App />, '/appointments/APT-20260101-9999');
    await screen.findByRole('heading', { name: 'Appointment not found' });
    expect(document.body.textContent).not.toMatch(CODE);
  });
});
