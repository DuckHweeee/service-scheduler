# Brief W1-A2 — Availability engine (pure domain)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md` and `docs/SPEC.md` §5 carefully — it is the
whole specification for this task. Run `pnpm install` in your worktree first.

## Goal
Implement the availability engine and same-day policy as **pure functions** with exhaustive tests. This is the heart
of requirement R2 ("a ServiceBay and a qualified Technician free for the entire duration").

## You own
- `apps/api/src/domain/availability/**` **except** `types.ts` (read-only, Opus-owned). Replace the stub bodies in
  `index.ts`; keep every exported name and type. Suggested split: `engine.ts` (computeSlots/checkWindow),
  `assignment.ts` (ranking), `alternatives.ts`, `same-day.ts` (evaluateSameDay/sameDayQuotaCap), `intervals.ts`.
- `apps/api/test/unit/availability/**`

Allowed new devDependency: none needed — `fast-check` and `@vitest/coverage-v8` are already installed.

## Rules (summary — SPEC §5 is authoritative)
- No `Date`, no luxon, no DB, no Fastify, no `@scheduler/contracts` runtime import (type imports are fine).
- Half-open intervals; a resource is free for `[t, t+d)` iff no busy `b` has `b.start < t+d && t < b.end`.
- Candidates `t = opensAt + k·step` while `t + d <= closesAt`; with `day.sameDay`, only `t >= earliestStart`.
- Status precedence and same-day quota exactly per §5.2; assignment ranking exactly per §5.3.
- `evaluateSameDay` check order 2 → 3 → 4/5 per §5.4; `earliestStart` = `nowMin + leadMin` rounded **up** to the grid
  anchored at `opensAt`, never before `opensAt`. `sameDayQuotaCap(bays, pct)` = `pct === 0 ? 0 : max(1, floor(bays·pct/100))`.
- `findAlternatives`: walk `days` in the given order; on `after.date` only slots with `start > after.start`; on later dates
  any `AVAILABLE` slot; stop at `limit`.
- `checkWindow(day, service, start)` must return exactly what `computeSlots` would return for that start (also for starts
  that are off-grid or outside hours: then status is computed for the window but callers validate alignment separately —
  if `start + d > closesAt` or `start < opensAt`, return `FULLY_BOOKED` with `proposed: null`).

## Tests
- Build a readable fixture helper, e.g. `makeDlr01Day({ busy: { 'TEC-01': ['10:30-11:00'], 'BAY-03': ['08:00-17:00'] },
  sameDay: { earliestStart: '11:30', quotaCap: 1, sameDayBusy: ['13:00-13:45'] } })`, using the DLR-01 seed from SPEC §7
  (5 bays, 4 technicians) and the 8 service types.
- Every row **T1–T21** in SPEC §5.5 is its own named test: `it('T5 partial overlap rejects the window', …)`.
- Property-based tests with fast-check: for random busy sets and services, (a) every `AVAILABLE` slot's proposed bay has an
  allowed type and is free, and its technician has the skill and is free, over the whole window; (b) every non-available
  status is justified (re-derive eligibility independently); (c) `checkWindow` agrees with `computeSlots` for every grid start.
- Coverage 100% lines and branches for `src/domain/availability/**`:
  `pnpm --filter @scheduler/api exec vitest run test/unit/availability --coverage --coverage.include='src/domain/availability/**'`

## Acceptance criteria
- [ ] T1–T21 implemented, named by id, all green.
- [ ] Property tests green (≥ 200 runs each).
- [ ] 100% line + branch coverage on the module (paste the coverage table in your report).
- [ ] `grep -rE "new Date|Date\.|luxon|from 'pg'|fastify" apps/api/src/domain/availability` returns nothing.
- [ ] `pnpm verify` green.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
