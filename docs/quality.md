# Quality evidence

Every number below came from a command run on commit `ecae8c8` on 2026-10-12 (Mac mini M4, Node 22.20, Vitest 3.2.7,
Stryker 9.6.1, Playwright 1.64). Reproduce with the commands at the bottom. Coverage and mutation are deliberately **not**
part of `pnpm verify` (kept fast); CI runs them in separate jobs (see [CI](#ci)).

## Test counts

| Suite | Command | Files | Tests |
|---|---|---|---|
| Contracts (schemas + fixtures) | `pnpm --filter @scheduler/contracts test` | 1 | 23 |
| API unit (engine, time, seed, telemetry) | `pnpm --filter @scheduler/api test:unit` | 8 | 83 |
| API integration (real embedded Postgres) | `pnpm --filter @scheduler/api test:int` | 19 | 181 |
| API total | `pnpm --filter @scheduler/api test` | 27 | 264 |
| Web (jsdom + MSW) | `pnpm --filter @scheduler/web test` | 9 | 52 |
| **`pnpm verify` total** | `pnpm verify` | 37 | **339** |
| e2e (Playwright, real API + DB + web) | `pnpm e2e` | 6 specs | **16 passed** (6 journeys + 10 screenshot tests at 1440 / 390 px) |

### Reschedule suites (Wave 5)

| File | Tests | What it proves |
|---|---|---|
| `apps/api/test/int/reschedule.test.ts` | 15 | SPEC §6.5 cases R1–R10, R14, R15 by id (plus R4b parts out of stock), 404/400, and `reschedule_attempts_total` on `/metrics` |
| `apps/api/test/int/reschedule-concurrency.test.ts` | 5 | R11 (20 parallel reschedules into a capacity-1 window → exactly 1×200, 19×409), R12 (reschedule ∥ new booking), R13 (crossing days, no deadlock), R15b (the same appointment moved to two different days in parallel, ADVANCE and SAME_DAY variants) |
| `apps/api/test/int/reschedule-review.test.ts` | 30 | W5-Q2 independent adversarial review: validation parity with booking (P1–P4), injected-clock lead time (L1–L4), parts/channel consistency after failures (C1–C5), grid ↔ reschedule golden check over every slot (G1–G6), history/audit (H1–H3), PII-free metric labels (M1), forced race interleavings (X1–X3), and the three defects it found (Q2-D1, Q2-D2, Q2-D3) |
| `e2e/06-reschedule.spec.ts` | 1 | Book → reschedule from the record → notice + history → old slot free again, on the real API |

## Coverage

v8 coverage, `text-summary` lines from `pnpm coverage`.

| Scope | Statements | Branches | Functions | Lines | Gate |
|---|---|---|---|---|---|
| API, unit + int (all `src/**`) | 94.58% (2639/2790) | 90.85% (735/809) | 92.07% (151/164) | 94.58% (2639/2790) | floor in `apps/api/vitest.config.ts`: lines/stmts 92, branches 89, functions 90 |
| API engine `src/domain/availability/**` | 100% | 100% | 100% | 100% | hard threshold 100% on all four metrics |
| Web (`src/**`) | 87.15% (3061/3512) | 81.6% (710/870) | 88.01% (191/217) | 87.15% (3061/3512) | none (reported only) |

Engine per file (from `apps/api/coverage/coverage-summary.json`): `alternatives`, `assignment`, `engine`, `index`,
`intervals`, `same-day`, `types` all at 100/100/100/100. `pnpm coverage` exits non-zero if a threshold is missed.

## Mutation testing

Stryker on `apps/api/src/domain/**`, unit tests only. Config: `apps/api/stryker.config.json` (vitest runner, `vitest.unit.config.ts` = `test/unit/**` only, no database).
`pnpm --filter @scheduler/api mutation` finished in 21 s.

| File | Score | Killed | Timeout | Survived | No coverage |
|---|---|---|---|---|---|
| **All files** | **98.77%** | 318 | 4 | 3 | 1 |
| `availability/alternatives.ts` | 100.00% | 25 | 0 | 0 | 0 |
| `availability/assignment.ts` | 96.00% | 24 | 0 | 1 | 0 |
| `availability/engine.ts` | 100.00% | 81 | 1 | 0 | 0 |
| `availability/intervals.ts` | 100.00% | 18 | 0 | 0 | 0 |
| `availability/same-day.ts` | 100.00% | 38 | 0 | 0 | 0 |
| `errors.ts` | 100.00% | 4 | 0 | 0 | 0 |
| `time.ts` | 97.76% | 128 | 3 | 2 | 1 |

How the score got there (W5-Q1 added `apps/api/test/unit/time.validation.test.ts`) is in
[`ai-log.md`](ai-log.md#wave-5--showcase-polish-2026-10-12). The 4 remaining mutants are judged **equivalent**:

| Mutant | Why equivalent |
|---|---|
| `time.ts:31` `{ zone: 'utc' }` -> `{}` | `parseDate` supplies year/month/day only; the date and weekday of a date-only value do not depend on the zone it is constructed in. |
| `time.ts:56` `if (!iso)` -> `false` | Luxon's `toISO` returns a string for every valid `DateTime`; validity is already checked in `inZone`, so the guard is unreachable (verified: a year-10000 instant does not return null). |
| `time.ts:56` message `'Unable to format instant'` -> `""` | Same unreachable branch (reported as "no coverage"). |
| `assignment.ts:4` `a.id < b.id` -> `<=` | Only differs when comparing an element with an equal id, which never occurs (ids are unique). |

Stryker covers the pure domain only. Concurrency and transaction code (`src/services/**`) is mutation-checked by hand at
each merge gate, below.

## Manual and adversarial checks

Recorded in [`ai-log.md`](ai-log.md). Done at merge gates: mutate production code (or remove a guard), run the suite, confirm red, revert.

| WP / gate | Mutant or finding | Result |
|---|---|---|
| W1-A2 engine | overlap `<` -> `<=` (breaks half-open / back-to-back) | 4 tests fail |
| W1-A2 engine | drop "fewest skills" ranking | 3 tests fail |
| W1-A2 engine | quota `>=` -> `>` (off-by-one) | 3 tests fail |
| W1-A2 engine | lead-time rounding `ceil` -> `floor` | 1 test fails |
| W2-A4 booking | advisory lock removed | 20 parallel requests for one slot still give exactly one 201 (the `EXCLUDE` constraints catch it) |
| Wave 2 gate | availability ignores `sameDay.blocked` | 2 tests fail |
| Wave 2 gate | board includes CANCELLED | 1 test fails |
| Wave 3 gate | grace boundary `>` -> `>=` | exit 1, 1 test fails |
| Wave 3 gate | late rule applied to advance bookings | exit 1, 1 test fails |
| W4 review-fix gate | source reverted, new tests kept | 8/8 new tests fail, exit 1 |
| W5-0b | `excludeAppointmentId` filter dropped | exclusion test red |
| W5-0a | exclusion dropped from the vehicle-busy filter | new day-plan test red |
| W5-F4 | "never mark Current" | Current-slot test red |
| W5-A8 gate | lock only the new day (agent's own mutation) | **all tests green → gap**; R15b added; lock removed → both R15b tests red |
| W5-Q2 review | SAME_DAY → ADVANCE released parts before the appointment row lock: deadlock vs cancel (D1) and vs the no-show sweeper (D2), 40P01 → HTTP 500 | reproduced; fixed with `SELECT … FOR UPDATE` on the appointment first; `FOR UPDATE` removed → D1, D2 red |
| W5-Q2 review | no-op reschedule of an ADVANCE booking whose day became today → 422 `SERVICE_NOT_EXPRESS` (D3) | reproduced; fixed by checking the no-op before target rules |
| W6-O1 | `loadtest/verify-invariants.sql` against a transaction with the exclusion constraints dropped and an overlapping row | reports `TECHNICIAN_OVERLAP` and `BAY_OVERLAP` |

## CI

Defined in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) and [`mutation.yml`](../.github/workflows/mutation.yml).
The `coverage`, `e2e` and `docker` jobs and the mutation workflow were added in Wave 5–6 and have **not yet run on GitHub**;
this is what they check:

| Job | Checks |
|---|---|
| `verify` | `pnpm install --frozen-lockfile`, `pnpm verify`, web production build |
| `coverage` | `pnpm coverage` (fails below the thresholds above); writes a coverage table to the job summary |
| `e2e` | Playwright with bundled Chromium against its own embedded Postgres + API + Vite; uploads traces on failure |
| `docker` | builds the images (amd64), boots `--profile app --profile obs`, checks `/health/ready`, the web and the Prometheus target, runs a 30 s k6 load and requires `verify-invariants.sql` to return no rows |
| `mutation.yml` | Stryker on demand and weekly (Mondays 03:00 UTC); score table in the job summary |

## How to reproduce

```bash
pnpm install
pnpm verify                                 # typecheck + lint + 339 tests
pnpm --filter @scheduler/api test:unit      # 83 tests
pnpm --filter @scheduler/api test:int       # 181 tests (starts embedded Postgres)
pnpm coverage                               # api + web; HTML in apps/{api,web}/coverage/
pnpm --filter @scheduler/api mutation       # Stryker, report in apps/api/reports/mutation/mutation.html
pnpm e2e                                    # Playwright, 16 tests
```
