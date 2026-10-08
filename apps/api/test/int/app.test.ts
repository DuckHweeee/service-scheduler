import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Problem } from '@scheduler/contracts';
import { z } from 'zod';
import { fixedClock } from '../../src/clock.js';
import { createDb } from '../../src/db/client.js';
import { DomainError } from '../../src/domain/errors.js';
import { buildTestApp, createTestDb, type TestDb } from '../helpers/index.js';

let t: TestDb;
let app: FastifyInstance;

beforeAll(async () => {
  t = await createTestDb();
  app = await buildTestApp({ db: t.db, clock: fixedClock('2026-10-08T09:10:00+07:00') });
  app.get('/__test/domain-error', async () => {
    throw new DomainError('SLOT_UNAVAILABLE', 409, 'Slot is taken', {
      reason: 'NO_BAY',
      alternatives: [
        { date: '2026-10-09', startTime: '11:00', endTime: '12:00', startAt: '2026-10-09T11:00:00+07:00' },
      ],
    });
  });
  app.get('/__test/pg-23p01', async () => {
    // drizzle wraps driver errors, so the SQLSTATE sits on `cause`
    throw new Error('Failed query', { cause: Object.assign(new Error('exclusion violation'), { code: '23P01' }) });
  });
  app.get('/__test/boom', async () => {
    throw new Error('secret internals');
  });
  app.get(
    '/__test/validated',
    { schema: { querystring: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }) } },
    async () => ({ ok: true }),
  );
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await t.cleanup();
});

describe('app', () => {
  it('unknown route → 404 problem+json', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = Problem.parse(res.json());
    expect(body).toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      title: 'Not found',
      type: 'https://scheduler.example/problems/not-found',
    });
  });

  it('stubbed business route → 501', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dealerships' });
    expect(res.statusCode).toBe(501);
  });

  it('health: live and ready', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: 'ok' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
  });

  it('health/ready → 503 problem when the database is unreachable', async () => {
    const dead = createDb('postgres://postgres:postgres@127.0.0.1:1/nope');
    const bad = await buildTestApp({ db: dead, clock: fixedClock('2026-10-08T09:10:00+07:00') });
    const res = await bad.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(Problem.parse(res.json()).status).toBe(503);
    await bad.close();
    await dead.$client.end();
  });

  it('echoes a provided x-request-id and generates one otherwise', async () => {
    const withId = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-request-id': 'req-abc-123' } });
    expect(withId.headers['x-request-id']).toBe('req-abc-123');
    const without = await app.inject({ method: 'GET', url: '/health/live' });
    expect(without.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const nf = await app.inject({ method: 'GET', url: '/nope', headers: { 'x-request-id': 'req-nf' } });
    expect(nf.headers['x-request-id']).toBe('req-nf');
  });

  it('renders a thrown DomainError with reason and alternatives', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/domain-error' });
    expect(res.statusCode).toBe(409);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = Problem.parse(res.json());
    expect(body).toMatchObject({
      type: 'https://scheduler.example/problems/slot-unavailable',
      title: 'Slot unavailable',
      status: 409,
      code: 'SLOT_UNAVAILABLE',
      detail: 'Slot is taken',
      reason: 'NO_BAY',
    });
    expect(body.alternatives).toHaveLength(1);
  });

  it('request validation failure → 400 VALIDATION_ERROR with errors[]', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/validated?date=oops' });
    expect(res.statusCode).toBe(400);
    const body = Problem.parse(res.json());
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.errors?.[0]).toMatchObject({ path: 'date' });
  });

  it('unexpected error → 500 INTERNAL_ERROR without leaking details', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(Problem.parse(res.json()).code).toBe('INTERNAL_ERROR');
    expect(res.body).not.toContain('secret internals');
  });

  it('serves swagger UI and the OpenAPI document', async () => {
    const ui = await app.inject({ method: 'GET', url: '/docs/' });
    expect(ui.statusCode).toBe(200);
    const json = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(json.statusCode).toBe(200);
    expect(json.json().openapi).toMatch(/^3\./);
  });

  it('maps a Postgres exclusion violation (23P01) to 409 SLOT_UNAVAILABLE', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/pg-23p01' });
    expect(res.statusCode).toBe(409);
    expect(Problem.parse(res.json()).code).toBe('SLOT_UNAVAILABLE');
  });
});
