# Brief W5-Q2 — Independent adversarial review of reschedule (sched-qa)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/SPEC.md` §6.1–§6.5 (v0.3), `docs/adr/006-reschedule-in-place.md`,
`apps/api/src/services/reschedule.ts`, `apps/api/test/int/reschedule*.test.ts`, and the W5 entries in `docs/ai-log.md`.

You did not write this code. Your job is to **find what its tests miss**, and prove each finding by experiment.

## Owns
- New test files only: `apps/api/test/int/reschedule-review.test.ts` (and `apps/web/src/screens/reschedule/*.review.test.tsx`
  if you find a UI defect). Never edit production code or existing tests.

## Method
1. List candidate defects by reading the code against SPEC §6.5 and ADR-006. Probe at least these:
   - Parts: ADVANCE→SAME_DAY when only some lines are in stock (partial reservation must roll back fully);
     SAME_DAY→SAME_DAY when the earlier reservation was already released (e.g. after a no-show sweep raced it);
     channel/parts consistency after a 409 at every step (row, `appointment_parts`, `inventory.reserved` unchanged).
   - Validation parity with booking (§6.1 step 1) for every 422 code, incl. same-day lead time computed at the right moment.
   - Reschedule ∥ check-in, reschedule ∥ no-show sweeper (`releaseLateSameDay`), reschedule ∥ cancel (R15 exists — check
     it actually races), and the idempotent no-op when the appointment is NOT reschedulable (must it still 409?).
   - `excludeReference` on availability: scope checks, a CANCELLED reference, and that the grid matches what reschedule
     then accepts (golden check: every AVAILABLE slot from the grid → reschedule 200 in a rolled-back/fresh copy).
   - History: summary for same-day vs cross-day, and the events written on failure.
   - Metrics labels: no PII, outcome/reason values bounded.
2. For each candidate write a test. Confirmed defect → keep the **failing** test, marked `it.fails(...)` with the defect
   in its title, so the suite stays green and the defect is visible. Not a defect → keep it as a passing regression test
   only if it covers something R1–R15b do not.
3. Do not fix anything. Opus decides and fixes.

## Report
Summary · each finding: severity, SPEC reference, minimal repro (test name), expected vs actual · tests added that pass ·
`pnpm verify` result. Commit `W5-Q2: reschedule adversarial review` on your worktree branch.
