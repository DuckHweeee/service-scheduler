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

## Parked (decide later)
- Board "incoming request / rejected / reserved" panels from the mock.
