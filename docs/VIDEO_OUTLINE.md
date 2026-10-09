# Video outline (target 8–9 minutes)

Maps one-to-one to the five points the brief asks for. Times are targets; the demo is the part to protect.

| # | Segment | Time | What to show | Talking points |
|---|---|---|---|---|
| 1 | Intro | 0:00–0:40 | README header + screenshots | Who you are. Scenario A: replace manual booking; confirm only when a bay **and** a qualified technician are free for the whole job. Chose the **backend** as the implemented layer; the web is a client harness built from the provided design. |
| 2 | System design | 0:40–2:40 | `docs/diagrams/architecture.png`, `booking-sequence.png`, `data-model.png` | Stateless Fastify API, shared zod contracts, pure availability engine, PostgreSQL. **Two layers against double booking:** advisory lock per dealership-day (correct re-check, reason, alternatives, same-day quota) + `EXCLUDE` constraints (the invariant, even if code is wrong). Same-day express policy (your rules: express-only, 2 h lead, 20% quota, parts in stock, 15 min late release). Observability: booking outcome metric with reasons, lock-wait vs reserve time, traces, audit trail. |
| 3 | Implementation highlights | 2:40–4:00 | `apps/api/src/domain/availability/engine.ts`, `services/booking.ts` (transaction), `drizzle/0001_constraints.sql`, `test/int/concurrency.test.ts` | Engine is pure (minutes, no Date) → T1–T21 + property tests, 100% coverage. Booking transaction step by step. Concurrency test: 20 parallel requests for one slot → exactly one 201 and one row; still true with the lock removed (mutation check). |
| 4 | AI collaboration story | 4:00–5:45 | `docs/agent-briefs/` (one brief), `docs/ai-log.md` (the "caught" table in README) | Strategy: decisions stay human; spec + contracts first; ten small work packages with exclusive file ownership, run in parallel worktrees; agents must report evidence and flag spec contradictions. Verification: diff review, mutation tests at every gate, running the real thing. Stories: agent caught a wrong expectation in the spec (T8); agent caught pnpm blocking Postgres on fresh clones; **the test runner exited 0 on failing tests** — found only because every gate deliberately broke the code; the seed made the default service unbookable — found by a manual smoke test. Own slips and the gate change. |
| 5 | Demo | 5:45–8:15 | `pnpm dev:real` (API + web), Swagger `/docs`, `/metrics` | 1) Book an advance brake job → confirmation → record (linked customer/vehicle/technician/bay, history). 2) Conflict: book a slot from a second tab/cURL, confirm the first → 409 with alternatives → pick one. 3) Today: oil change shows Express slots + notice; brake shows the not-express panel; set DLR-02 stock to 0 (or pick Riverside) → parts panel. 4) Service board → the new job; Check in. 5) `/metrics`: `booking_attempts_total` by outcome/reason. Tip: for same-day at any hour run the API with `CLOCK_OVERRIDE=<today>T09:10:00+07:00` and keep the browser on a matching day. |
| 6 | Learnings & challenges | 8:15–9:00 | — | Verifying AI output means verifying the *verification* too (the exit-code bug). Exclusion constraints turn a concurrency problem into a data invariant. Spec-first parallel agents scale, but integration still needs a human-run smoke test. What you'd do next (auth, reschedule, shifts, storage-level quota). |

## Before recording

- `pnpm db:up` → `pnpm db:migrate && pnpm db:seed` (fresh seed = clean demo data), then `pnpm dev:real`.
- Pre-open tabs: README, SYSTEM_DESIGN diagrams, ai-log, one agent brief, Swagger `/docs`, `/metrics`, the web app.
- Rehearse the conflict step: have the cURL from `docs/curl-examples.md` ready.
- Check the clock: same-day slots exist only before ~15:00 dealership time unless you pin `CLOCK_OVERRIDE`.
