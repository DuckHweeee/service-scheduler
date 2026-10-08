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

## Parked (decide later)
- Board "incoming request / rejected / reserved" panels from the mock.
