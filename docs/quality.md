# Quality evidence

Every number below came from a command run on 2026-10-12 (Mac mini M4, Node 22, Vitest 3.2, Stryker 9.6). Reproduce with
the commands at the bottom. Coverage and mutation are deliberately **not** part of `pnpm verify` (kept fast).

## Test counts

| Suite | Command | Files | Tests |
|---|---|---|---|
| API unit | `pnpm --filter @scheduler/api test:unit` | 8 | 83 |
| API integration (real embedded Postgres) | `pnpm --filter @scheduler/api test:int` | 16 | 123 |
| API total | `pnpm --filter @scheduler/api test` | 24 | 206 |
| Web (jsdom + MSW) | `pnpm --filter @scheduler/web test` | 8 | 46 |
| e2e (Playwright) | `pnpm e2e` | 5 specs | 9 `test(...)` cases (counted from `e2e/*.spec.ts`; not run for this report) |

## Coverage (v8, `text-summary`)

| Scope | Statements | Branches | Functions | Lines | Gate |
|---|---|---|---|---|---|
| API, unit + int (all `src/**`) | 94.16% (2357/2503) | 91.15% (639/701) | 92.25% (143/155) | 94.16% (2357/2503) | floor: lines/stmts 92, branches 89, functions 90 (measured, rounded down, minus 2) |
| API engine `src/domain/availability/**` | 100% | 100% | 100% | 100% | hard threshold 100% on all four metrics |
| Web (`src/**`) | 88.29% (2655/3007) | 82.85% (604/729) | 89.28% (175/196) | 88.29% (2655/3007) | none yet (reported only) |

The engine was measured per file (`alternatives`, `assignment`, `engine`, `index`, `intervals`, `same-day`, `types`): all at 100/100/100/100.
Thresholds live in `apps/api/vitest.config.ts`; `test:coverage` fails if they are not met.

## Mutation testing (Stryker, `src/domain/**`, unit tests only)

Config: `apps/api/stryker.config.json` (vitest runner, `vitest.unit.config.ts` = `test/unit/**` only, no database).
Run time about 20 s.

| | Before new tests | After new tests |
|---|---|---|
| Mutation score (total) | 86.81% | **98.77%** |
| Killed | 279 | 318 |
| Timeout (counted as detected) | 4 | 4 |
| Survived | 30 | 3 |
| No coverage | 13 | 1 |
| Errors | 0 | 0 |

Per file after: `alternatives` 100, `engine` 100, `same-day` 100, `intervals` 100, `errors` 100, `assignment` 96.00, `time` 97.76.
New killing tests: `apps/api/test/unit/time.validation.test.ts` (time parse/format boundaries and error paths, `DomainError`/`notFound`, `busyMinutes`).

Remaining 4 mutants, all judged **equivalent** (count: 4 equivalent, so the effective score excluding them is 100% of non-equivalent mutants):

| Mutant | Why equivalent |
|---|---|
| `time.ts:31` `{ zone: 'utc' }` -> `{}` | `parseDate` supplies year/month/day only; the date and weekday of a date-only value do not depend on the zone it is constructed in. |
| `time.ts:56` `if (!iso)` -> `false` | Luxon's `toISO` returns a string for every valid `DateTime`; validity is already checked in `inZone`, so the guard is unreachable (verified: a year-10000 instant does not return null). |
| `time.ts:56` message `'Unable to format instant'` -> `""` | Same unreachable branch. |
| `assignment.ts:4` `a.id < b.id` -> `<=` | Only differs when comparing an element with an equal id, which never occurs (ids are unique). |

## Manual gate mutation checks (from `docs/ai-log.md`)

Done by hand at merge gates: mutate production code, run suite, revert.

| WP / gate | Mutant | Result (test that went red) |
|---|---|---|
| W1-A2 engine | overlap `<` -> `<=` (breaks half-open / back-to-back) | 4 tests fail |
| W1-A2 engine | drop "fewest skills" ranking | 3 tests fail |
| W1-A2 engine | quota `>=` -> `>` (off-by-one) | 3 tests fail |
| W1-A2 engine | lead-time rounding `ceil` -> `floor` | 1 test fails |
| Wave 2 gate | availability ignores `sameDay.blocked` | 2 tests fail |
| Wave 2 gate | board includes CANCELLED | 1 test fails |
| Wave 3 gate | grace boundary `>` -> `>=` | exit 1, 1 test fails |
| Wave 3 gate | late rule applied to advance bookings | exit 1, 1 test fails |
| Review-fix gate | source reverted, new tests kept | 8/8 new tests fail, exit 1 |

(The ai-log entries name the mutant and failing count, not individual test titles; the automated Stryker run above supersedes this manual list for `src/domain/**`.)

## How to reproduce

```bash
pnpm install
pnpm --filter @scheduler/api test:unit      # 83 tests
pnpm --filter @scheduler/api test:int       # 123 tests (starts embedded Postgres)
pnpm --filter @scheduler/api test:coverage  # unit + int, thresholds enforced, HTML in apps/api/coverage/
pnpm --filter @scheduler/web test:coverage  # HTML in apps/web/coverage/
pnpm coverage                               # both packages
pnpm --filter @scheduler/api mutation       # Stryker, report in apps/api/reports/mutation/mutation.html
pnpm e2e                                    # Playwright
```
