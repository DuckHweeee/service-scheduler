# AI collaboration log

Running record for the README's *AI Collaboration Narrative*. One entry per wave: what was delegated, how it was
verified, what was caught and corrected. Agent prompts are archived verbatim in `docs/agent-briefs/`.

## Wave 0 — design & contracts (Huy + Opus, 2026-10-08)

- **Input:** challenge PDF + Claude Design bundle (`Unified Service Scheduler.html`). Opus unpacked the bundle (gzip+base64
  manifest) into `design/screens/` and read the mock logic to extract the domain model (service → required skill + allowed
  bays, technician skills, 08:00–17:00 day, 30-minute grid, UTC+7).
- **Decisions by Huy:** backend as the full layer, TypeScript end-to-end, full scope (alternatives, history, board, cancel),
  ~1 week. Huy added the same-day express policy (express-only, lead time, quota, parts check, instant confirm, late release)
  → SPEC v0.2, ADR-005. Opus decided the remaining rules on Huy's request (assignment heuristic, hours, grid).
- **Verified before relying on it:** no Docker on the dev Mac (macOS 12) → probed `embedded-postgres`: PG 18.4 starts,
  `btree_gist` loads, an overlapping `tstzrange` insert is rejected with `23P01`. Chose it over Homebrew/Testcontainers.
- **Spec self-review caught:** test case T10 originally asserted TEC-03 for an empty-day oil change, but the stated rule
  (fewest skills → busy minutes → id) yields TEC-02 — split into T10a/T10b with explicit setup.
- **Guard-rails for agents:** contracts, engine types, router, error class and clock written by Opus first; fixtures are
  validated against the schemas by tests (14 passing); every WP has exclusive file ownership.

## Wave 1 — A2 availability engine (Sonnet, merged 2026-10-08)

- **Delivered:** pure engine split into intervals / engine / assignment / alternatives / same-day; 35 unit tests incl.
  T1–T21 by id and 3 fast-check properties (300 runs each, independent minute-by-minute re-derivation); 100% line + branch
  coverage; purity grep clean.
- **The agent caught a spec bug written by Opus:** T8 expected `NO_QUALIFIED_TECHNICIAN` only up to 10:30, but a 90-minute
  job starting 11:00 or 11:30 still overlaps 08:00–12:00. Opus re-derived it by hand, agreed, and corrected SPEC T8. The
  brief had told agents to implement the rules and flag contradictions rather than bend tests — that instruction paid off.
- **Process deviation noted:** the brief asked for tests-first; the agent wrote implementation first and said so.
  Compensated by mutation testing at the gate.
- **Gate — mutation checks (Opus):** each mutant run against the suite, then reverted.

  | Mutant | Result |
  |---|---|
  | overlap `<` → `<=` (breaks half-open / back-to-back) | 4 tests fail |
  | drop "fewest skills" ranking | 3 tests fail |
  | quota `>=` → `>` (off-by-one) | 3 tests fail |
  | lead-time rounding `ceil` → `floor` | 1 test fails |

- **Accepted assumptions:** `checkWindow` does not apply `earliestStart` (booking validates lead time explicitly and returns
  `LEAD_TIME_NOT_MET`); `evaluateSameDay` still returns `earliestStart`/`quotaCap` when blocked.
- **Opus slip, fixed:** a `git add -A` in the main checkout staged the agents' worktrees (`.claude/worktrees/`) as embedded
  repos; amended before push and added to `.gitignore`.

## Wave 1 — A1 API foundation (Sonnet, merged 2026-10-08)

- **Delivered:** config, RFC 7807 error handler (DomainError, zod, `23P01` → 409, 404, safe 500), request ids, health,
  Swagger, SPEC §4 schema with a hand-written constraints migration, `time.ts` (DST-tested), repositories incl.
  `loadDayContext` and `partsAvailability`, deterministic seed, embedded-Postgres test harness (ephemeral instance on a
  random port + per-file template clones). 45 tests.
- **The agent found a real defect in an Opus-owned file:** pnpm 10 blocks dependency build scripts by default, so
  `@embedded-postgres/*`'s postinstall (ICU dylib symlinks) never ran → Postgres could not start on a fresh clone. It
  worked around it locally, did *not* edit the Opus-owned file, and reported it. Opus confirmed (`libicudata.77.dylib`
  symlink missing), added the packages to `onlyBuiltDependencies`, and verified with a clean `rm -rf node_modules` reinstall.
- **Integration check A1 × A2 (Opus):** after merging both, `db:seed` ran the background load through the real engine:
  858 appointments, 50–51% bay utilisation per dealership-day, zero constraint violations — the two independently built
  halves fitted on the first run because both coded against the Wave 0 `types.ts`.
- **Opus glue for W2:** `services/day-plan.ts` (plan resolution, alternatives, DTO mappers) with 6 integration tests.
  Opus's own test initially failed — the expected horizon date assumed October has 30 days; the code was right.

## Wave 1 — F1 web shell + Book screen (Sonnet, merged 2026-10-08)

- **Delivered:** app shell, typed API client (contract-validated, problem+json → `ApiError`), hooks for every endpoint,
  MSW handlers with a client-side port of the §5 rules and `?mock=conflict|parts|cutoff|morning` scenarios, the full Book
  screen incl. same-day states. 26 component/mock tests.
- **Honest gap in the report:** the agent could not get a browser screenshot (headless Chrome + service worker) and marked
  the 1440/390 px criterion ❌ instead of claiming it. Opus closed the gap: Playwright's bundled Chromium refuses macOS 12,
  so Opus drove the system Google Chrome via `executablePath`, captured `docs/screenshots/book-*.png` at 1440 and 390 px,
  confirmed no page-level horizontal scroll (scrollWidth = viewport) and compared against design 01 by eye. The same-day
  "morning" scenario shows earliest start 11:30, Express labels, the late-arrival notice and Marco Ortiz assigned for an
  oil change (consistent with engine test T10a).

## Wave 2 — A3 read endpoints (Sonnet, merged 2026-10-08)

- **Delivered:** reference, availability (via `resolveDayPlan` + engine — no duplicated rules), board, inventory GET/PUT
  with contract schemas on every route (so they appear in `/docs`); race-free `PUT` (single guarded `UPDATE`). 21 tests.
- **Ownership deviation, accepted:** the agent deleted A1's `stubbed route → 501` test, which by construction had to fail
  once `/dealerships` was implemented. It disclosed this instead of hiding it. Lesson for briefs: temporary scaffolding tests
  should be marked as such.
- **Gate — mutation checks:** availability ignoring `sameDay.blocked` → 2 tests fail; board including CANCELLED → 1 fails.
- **Opus slip, fixed:** root ESLint was linting agents' in-progress worktrees under `.claude/worktrees/`, and Opus's gate
  piped `pnpm verify` into `grep`, which hid the non-zero exit. Fixed the ignore list and switched gates to checking `$?`.

## Wave 2 — A4 booking command (Sonnet, merged 2026-10-08)

- **Delivered:** SPEC §6.1 transaction (advisory lock → idempotency re-check → fresh `resolveDayPlan(tx)` → vehicle overlap →
  `checkWindow` → conditional parts `UPDATE` → insert + events), `CHECK_FAILED` after rollback, `23P01` mapped by constraint
  name, list/detail/cancel, history sentences. 46 integration tests incl. 20-way concurrency, same-day quota race, parts race,
  concurrent idempotency.
- **The agent's own mutation check found a real bug:** with concurrent requests sharing an `Idempotency-Key`, some got 409
  (exclusion violation) instead of 200. Fixed by resolving the key in the error path. It also showed the advisory lock is what
  enforces the same-day quota (no constraint can count across different resources) → documented in ADR-002.
- **Opus review → one change sent back:** the agent deduplicated `SLOT_REQUESTED` per session, which dropped design 03's
  "Customer chose 13:00–15:00" line. Sent back with exact expected sentences; the agent fixed it in its own files.
- **Reported by the agent, fixed by Opus:** `Promise.all` over a transaction client in Opus's `day-plan.ts` (and A1's
  `loadDayContext`) triggers pg's "already executing a query" deprecation (an error in pg 9). Made both sequential.
- **Biggest catch of the project so far — the gate itself was broken.** While mutation-testing A4, Opus noticed a deliberately
  broken run exited **0**. Root cause: `embedded-postgres` imports `async-exit-hook`, which hooks `beforeExit` and calls
  `process.exit(0)`, overwriting vitest's `process.exitCode = 1`. Every `pnpm verify` so far would have passed even with red
  tests. Earlier gates were still valid (they were judged on the per-test pass/fail counts, and every run showed 0 failures),
  but CI would have been blind. Fix in `test/helpers/global-setup.ts` re-applies the exit code; proven with the mutant
  (exit 1) and the clean tree (exit 0).

## Wave 2 — F2 record / list / board screens (Sonnet, merged 2026-10-08)

- **Delivered:** design 03 record (cancel dialog with focus trap, `.ics` export, history timeline, stored-fields table),
  My appointments tabs, design 02 board (grid from opening hours, Express marking, Check in with live-region result, no-show
  styling), demo seed in the mock handlers. 20 new tests. This time the agent took its own Chrome screenshots using the
  `executablePath` workaround Opus put in the brief after F1.
- **Opus visual gate:** re-shot board/record/list at 1440 px (no page-level horizontal scroll) — faithful to designs 02/03.
  At 390 px the header wraps to four rows and the day-nav "next" button drops to its own line: usable, not polished →
  assigned to F3. Opus aligned its own fixture ("Customer chose 13:00–15:00") with the A4 history wording — and broke `main`
  for one commit by running only the contracts tests before pushing (a web test asserted the old text). Rule tightened:
  Opus runs full `pnpm verify` + exit code before every push, no exceptions.

## Wave 3 — A7 late-arrival policy (Sonnet, merged 2026-10-08)

- **Delivered:** check-in endpoint (inclusive 15-minute grace, same-day only), `markLateNoShow` shared with the 60 s sweeper,
  guarded `UPDATE … WHERE status='CONFIRMED' AND checked_in_at IS NULL` so check-in / cancel / sweeper races resolve to one
  outcome; reuses Opus's `releaseParts`. 10 integration tests incl. a check-in vs sweeper race.
- **Good judgement by the agent:** the late NO_SHOW transition is committed *before* the 409 is thrown — throwing inside
  the transaction would have rolled the release back and left the slot blocked.
- **Gate — mutation checks (exit codes now trustworthy):** grace boundary `>` → `>=` → exit 1 (1 test); late rule applied to
  advance bookings → exit 1 (1 test).

## Parked (decide later)
- Board "incoming request / rejected / reserved" panels from the mock.
