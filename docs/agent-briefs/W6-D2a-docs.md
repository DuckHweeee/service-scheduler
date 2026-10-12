# Brief W6-D2a — Documentation pass for Wave 5–6 (general-purpose)

Audience: a reviewer of the Keyloop assessment opening the repo cold. They will skim the README first, then
SYSTEM_DESIGN, and click into evidence. Every claim must be checkable.

Read first: `AGENT.md`, `CLAUDE.md`, `docs/ai-log.md` (Wave 5 section), `docs/SPEC.md` §6.5, `docs/adr/006-*.md`,
`docs/quality.md`, `docs/performance.md`, `docs/observability.md`, `docker-compose.yml`, `loadtest/README.md`,
`.github/workflows/*.yml`, `e2e/*.spec.ts`.

## Owns
`README.md`, `docs/SYSTEM_DESIGN.md`, `docs/PLAN.md`, `docs/VIDEO_OUTLINE.md`, `docs/quality.md`,
`docs/observability.md`. Nothing else (no code, no SPEC, no ADRs, no ai-log).

## Hard rule: numbers
Every number you write (test counts, coverage, mutation score, latency, RPS) must come from a command you ran on this
commit or from `docs/performance.md` (load test — do **not** re-run k6). Run: `pnpm verify`, `pnpm coverage`,
`pnpm --filter @scheduler/api mutation`, `pnpm e2e` (Playwright: `pnpm exec playwright install chromium` if needed).
Paste the raw summary lines in your report. The new CI jobs (`coverage`, `e2e`, `docker`, `mutation.yml`) have **never
run on GitHub** (nothing is pushed) — do not claim they are green; describe what they check.

## Deliverables
1. **README.md**
   - CI badge for `.github/workflows/ci.yml` on `DuckHweeee/service-scheduler`.
   - Right under the intro: a compact **"Evidence"** table — tests (unit / int / web / e2e), engine coverage 100% +
     API coverage, mutation score, concurrency proofs (20 parallel → 1×201; reschedule R11/R15b; Q2 deadlock found and
     fixed), load test headline (RPS, booking p95, 0 invariant violations) — each row linking to its source doc.
   - Screenshot grid: add the reschedule screen and `docs/screenshots/grafana.png`.
   - Build and run: two paths — (a) pnpm + embedded Postgres (existing), (b) `docker compose --profile app up --build`
     and `--profile obs` (Grafana :3001, Prometheus :9090, Jaeger :16686), port-override env vars, demo clock. Commands
     exactly as in the W6-O1 section of `docker-compose.yml` / `loadtest/README.md`; note `pnpm db:up` and the `app`
     profile both want :54329.
   - API at a glance: add reschedule + `excludeReference`.
   - Known limitations: add reference `nextval % 10000` can collide per date at scale; grid not vehicle-aware (already?
     keep one entry); tracing head-sampled at 10% by default in compose (100% OOM-killed Jaeger under load); the API
     image runs TypeScript through `tsx` (no compile step).
   - AI Collaboration Narrative: it is **Huy's text** — do not rewrite his voice. Only append factual Wave 5 items to
     "What the process caught" (from ai-log: the W5-A8 old-day-lock gap → R15b; the W5-Q2 independent review that found
     the lock-order deadlock; deny rules applying to the orchestrator too; e2e failures that were test data, not app),
     one or two lines each, and mark the section header "(draft — Huy to edit)" if it is not already marked.
2. **docs/SYSTEM_DESIGN.md**
   - Data flow: new **4.x Reschedule** subsection with a mermaid sequence diagram (two ordered advisory locks,
     `SELECT … FOR UPDATE` on the appointment, re-check excluding itself, parts by channel transition, guarded UPDATE,
     event; 409 path).
   - Section 6: replace or add the scalability numbers from `docs/performance.md` (what the per-dealership-day lock
     serialises, lock-wait p95).
   - Section 7: Grafana dashboard panels, sampling note, `reschedule_attempts_total`.
   - Section 10 Future work: **Auth** (customer vs advisor roles, JWT, route guards — board/check-in/inventory advisor-only)
     and **Technician shifts** (`technician_shifts` table; engine takes per-technician availability windows instead of
     opening hours; DayContext change) — a short design sketch each, not code. Remove reschedule from future work.
3. **docs/quality.md**: refresh every count and score from your runs; add the reschedule suites (R1–R15b, Q2 review) and
   the Q2 findings to the manual/adversarial table; e2e real count from `pnpm e2e`.
4. **docs/observability.md**: Grafana/Prometheus section (how to open, panels, sampling env vars).
5. **docs/PLAN.md**: tick every W0–W4 checkbox that is actually done (verify each against the repo); add a "Wave 5–6"
   section summarising WPs (W5-0a/0b, A8, F4, Q1, Q2, O1, D2a/b) with their status; fix the §3 risk "No Docker on
   macOS 12" (now: Mac mini M4 with Docker; embedded-postgres still the default no-Docker path).
6. **docs/VIDEO_OUTLINE.md**: add a reschedule step to the demo and a 20-second Grafana-under-load moment; add the Q2
   deadlock story to the AI segment. Keep the total within 10 minutes.

## Acceptance criteria
- [ ] Every number traceable to a pasted command output (or performance.md).
- [ ] All relative links in the touched docs resolve (check with a script; paste the result).
- [ ] `pnpm verify` green (prettier/eslint do not cover md, but don't break anything).
- [ ] No claims about CI results; no edits outside *Owns*.

Commit on your worktree branch: `W6-D2a: docs for reschedule, quality evidence, Docker/obs, plan status`.
