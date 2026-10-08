# Brief W1-A1 — API foundation

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` (§2, §4, §6, §7) and
the A1 section of `docs/PLAN.md` first. Run `pnpm install` in your worktree before anything else.

## Goal
A bootable Fastify service with config, DB schema + migrations, seed, error model, request ids/logging, health,
OpenAPI docs, timezone utilities and the **shared data-access layer** that W2 agents will consume.

## You own (create/modify only these)
- `apps/api/src/app.ts`, `apps/api/src/server.ts`, `apps/api/src/config.ts`
- `apps/api/src/plugins/**`
- `apps/api/src/db/**` (replace the Wave 0 placeholders; keep exported names `Db`, `Tx`, `DbOrTx`, `createDb`)
- `apps/api/src/domain/time.ts`
- `apps/api/src/routes/health.ts` (register it from `app.ts`, not from `routes/index.ts`)
- `apps/api/drizzle/**`, `apps/api/drizzle.config.ts`
- `apps/api/scripts/{db-up,migrate,seed}.ts`, `apps/api/src/db/seed/**`
- `apps/api/test/helpers/**`, `apps/api/test/int/db.*.test.ts`, `apps/api/test/unit/time.test.ts`,
  `apps/api/test/unit/seed.test.ts`, `apps/api/test/int/app.test.ts`
- `apps/api/vitest.config.ts` (to add globalSetup)

Read-only for you: everything else, in particular `packages/contracts/**`, `src/domain/availability/**`,
`src/domain/errors.ts`, `src/clock.ts`, `src/routes/index.ts`, `src/types/**`.

## Deliverables

1. **Config** (`config.ts`): zod-validated env — `DATABASE_URL`, `PORT` (3000), `LOG_LEVEL` (info), `CORS_ORIGIN`
   (`http://localhost:5173`), `CLOCK_OVERRIDE` (optional ISO), `NODE_ENV`.
2. **App** (`app.ts`): `buildApp({ db, clock, logger? })` — keep this signature (tests call it). Use
   `fastify-type-provider-zod` validator + serializer compilers, `@fastify/swagger` with `jsonSchemaTransform`,
   swagger UI at `/docs`, `@fastify/cors`, decorate `db` and `clock`, then `registerRoutes(app)` from `routes/index.ts`.
   Request id: honour incoming `x-request-id` else generate a uuid; echo it in the response header; pino JSON logs carry it.
3. **Error handler plugin** → RFC 7807 `application/problem+json` exactly matching the `Problem` schema in contracts:
   - `DomainError` → its `status`/`code`/message plus `reason`/`alternatives` extras.
   - Zod request validation errors → 400 `VALIDATION_ERROR` with `errors: [{ path, message }]`.
   - Postgres `23P01` (exclusion violation) → 409 `SLOT_UNAVAILABLE` (defence in depth, ADR-002).
   - Unknown route → 404 `NOT_FOUND`. Anything else → 500 `INTERNAL_ERROR` (log the stack, never leak it).
   - `type` = `https://scheduler.example/problems/<code in kebab-case>`; `title` = humanised code.
4. **Schema + migrations** matching SPEC §4 *exactly* (names, types, defaults, constraints). Drizzle table definitions in
   `src/db/schema.ts`; generate the base migration with drizzle-kit, then a **hand-written SQL migration** for
   `btree_gist`, the generated `during` column, the three `EXCLUDE` constraints, the composite FKs, `CHECK`s and the
   sequence if drizzle cannot express them. `scripts/migrate.ts` applies migrations to `DATABASE_URL`.
5. **Embedded Postgres** (`embedded-postgres` is installed):
   - `scripts/db-up.ts`: persistent instance, data dir `<repo>/.pgdata`, port 54329, user/password `postgres`/`postgres`,
     creates database `scheduler` if missing, stays in the foreground until Ctrl-C (graceful stop).
   - **Test helpers** (`test/helpers/`): a vitest `globalSetup` that starts an *ephemeral* instance on a **free random
     port** (W2 agents run test suites concurrently) unless `TEST_DATABASE_URL` is set, migrates a template database once,
     and exposes the URL via `provide`/env. `createTestDb()` → `{ db, url, cleanup }` creates a fresh database from the
     template (`CREATE DATABASE … TEMPLATE …`) so each test file is isolated. `seedReference(db)` inserts the SPEC §7
     reference data (no background appointments). `buildTestApp({ db, clock })` wraps `buildApp`. Document usage in a
     header comment — W2 agents will rely on it.
6. **Time utilities** (`src/domain/time.ts`, luxon allowed here): `parseLocalTime('13:00') → 780`,
   `formatLocalTime(780) → '13:00'`, `toInstant(localDate, minutes, tz) → Date`, `toOffsetIso(instant, tz)` (e.g.
   `2026-10-08T13:00:00+07:00`, no milliseconds), `localDateOf(instant, tz)`, `localMinutesOf(instant, tz)`,
   `localToday(clock, tz)`, `addLocalDays(localDate, n)`, `isoWeekday(localDate)`, `isWorkingDay(localDate, workingDays)`,
   `nextWorkingDays(fromLocalDate, n, workingDays)`. Unit tests incl. Europe/London across a DST change.
7. **Repositories** (`src/db/repositories/`), each taking `DbOrTx` first:
   - reference lookups: `listDealerships`, `getDealership`, `listServiceTypes`, `getServiceType`, `getCustomer`,
     `getVehicle`, `listVehiclesByCustomer`, `listBays(dealershipId)`, `listTechnicians(dealershipId)`, returning plain
     typed rows (times as `HH:mm` strings, arrays as arrays).
   - `loadDayContext(db, dealership, localDate, opts: { sameDay: { earliestStart: number; quotaCap: number } | null })
     → DayContext` (type from `src/domain/availability/types.ts`): busy intervals of **CONFIRMED** appointments on that local
     date per bay and technician in local minutes; `sameDay.sameDayBusy` from `channel = 'SAME_DAY'` rows; `isWorkingDay`
     from `working_days`.
   - `partsAvailability(db, dealershipId, serviceTypeCode, vehicleModel) → { available: boolean; lines: { sku; name; qty }[] }`
     — model-specific requirement rows replace the `NULL`-model rows; no requirements → available with empty lines;
     available iff `on_hand - reserved >= qty` for every line.
8. **Seed** (`scripts/seed.ts`, logic in `src/db/seed/`): truncate + rebuild. `seedReferenceData(db)` per SPEC §7 and
   `seedBackgroundLoad(db, { clock, rng, engine })` — `engine` defaults to `{ computeSlots }` from
   `src/domain/availability/index.js` but is injectable. The real engine is a **stub that throws** until A2 merges, so your
   unit test injects a small fake engine. Background appointments: `ADVANCE` channel, `CONFIRMED`, valid references from the
   sequence, never overlapping for bay/tech/vehicle (pick vehicles not busy in the window), ~50% bay utilisation per
   dealership-day for today + next 10 working days, PRNG seeded with 42 (implement a tiny mulberry32; no new deps).
   Insert one `APPOINTMENT_CREATED` booking event per seeded appointment with `detail: { seeded: true }`.
9. **Health**: `GET /health/live` → `{ status: 'ok' }`; `GET /health/ready` → DB `select 1`, 503 problem on failure.

## Acceptance criteria
- [ ] `pnpm db:up` (other terminal) → `pnpm db:migrate && pnpm db:seed` works, and running both again works (idempotent).
      Until A2 merges, `db:seed` may stop after reference data with a clear log line if the engine stub throws.
- [ ] Integration: two overlapping CONFIRMED appointments for the same technician → `23P01`; same for bay; same for vehicle;
      a CANCELLED or NO_SHOW overlap is allowed; back-to-back `[10:00,12:00)` + `[12:00,13:00)` allowed.
- [ ] Integration: a DLR-02 technician on a DLR-01 appointment is rejected by the composite FK.
- [ ] Integration: `inventory.reserved > on_hand` rejected; `partsAvailability` honours model override, and DLR-02 +
      OIL_CHANGE + "Crossover LX" → unavailable (FLT-OIL-CX22 = 0).
- [ ] Integration: `loadDayContext` returns local-minute intervals, ignores cancelled/no-show rows and other dates, fills
      `sameDayBusy` only from SAME_DAY rows.
- [ ] `app.inject` tests: unknown route → 404 problem+json; a stubbed route → 501; `/health/ready` → 200;
      `x-request-id` echoed; a thrown `DomainError` renders the right problem body (register a throwaway test route).
- [ ] Unit: time utilities incl. DST; seed background load with a fake engine never produces overlaps and is deterministic
      for a fixed clock + seed.
- [ ] `pnpm verify` green.

## Out of scope
Business endpoints (stubs stay 501), metrics/tracing, anything under `apps/web`.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
