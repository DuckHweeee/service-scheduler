# Brief W5-Q1 — Quality evidence: coverage + mutation testing (sched-qa)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/ai-log.md` (every "Gate — mutation check" entry), `apps/api/vitest.config.ts`,
`apps/web/vite.config.ts` (or vitest config). Run `pnpm install`.

## Goal
Turn "we tested it well" into numbers a reviewer can reproduce in one command, and record them in `docs/quality.md`.

## Owns
- `apps/api/vitest.config.ts`, `apps/web` vitest config (coverage section only)
- `apps/api/package.json`, `apps/web/package.json`, root `package.json` — **scripts and devDependencies only**
- `apps/api/stryker.config.json` (new), `.gitignore` (add `reports/`, `.stryker-tmp/`, `coverage/` if missing)
- `apps/api/test/unit/**` — new tests that kill surviving mutants (add only; don't weaken existing tests)
- `docs/quality.md` (new)

Not yours: `.github/workflows/**` (L4) — put the CI job you want in your report as YAML; Opus adds it.
Do not touch `src/domain/availability/**` source or the reschedule files (A8 is working in parallel).

## Allowed new devDependencies
`@stryker-mutator/core`, `@stryker-mutator/vitest-runner` (api only). `@vitest/coverage-v8` already exists.

## Deliverables
1. `test:coverage` scripts (api: unit + int; web) producing `text-summary` + `json-summary` + `html`.
   Thresholds in the api config: **100% lines/branches/functions/statements for `src/domain/availability/**`**
   (PLAN W1-A2 promised this — if it is not 100% today, add the missing unit tests), and a global floor set to the
   measured value rounded down to the nearest integer minus 2. Root script `coverage` runs both.
2. Stryker on `src/domain/**` with the vitest runner using **unit tests only** (`test/unit/**`); `mutation` script in
   api. Report the score; for each surviving mutant either add a unit test that kills it or list it as equivalent with a
   one-line reason. Target ≥ 85% (record the true number either way).
3. `docs/quality.md`: tables for test counts (unit / int / web / e2e), coverage per package and for the engine,
   mutation score (killed / survived / equivalent / timeout), the manual gate mutation checks pulled from `ai-log.md`
   (WP, mutant, test that went red), and "how to reproduce" commands. Every number must come from a command you ran —
   paste the raw summary lines in your report.

## Acceptance criteria
- [ ] `pnpm --filter @scheduler/api test:coverage` passes its thresholds; engine at 100%.
- [ ] `pnpm --filter @scheduler/api mutation` runs to completion locally; score in `docs/quality.md` matches its output.
- [ ] `pnpm verify` green (coverage/mutation are **not** part of `verify` — keep it fast).
- [ ] Report includes proposed CI YAML for a `coverage` job (upload `coverage/` artifact, write
      `coverage-summary.json` totals to `$GITHUB_STEP_SUMMARY`) and a `mutation.yml` (`workflow_dispatch` + weekly cron).

Commit on your worktree branch: `W5-Q1: coverage thresholds, Stryker, docs/quality.md`. Final report per `AGENT.md`.
