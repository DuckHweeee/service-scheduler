# Unified Service Scheduler — agent conventions

Read before any work: `docs/SPEC.md` (the contract) and your work package in `docs/PLAN.md` / `docs/agent-briefs/`.

## Commands
- `pnpm install` — workspace install (pnpm 10 via corepack)
- `pnpm verify` — typecheck + lint + all tests. **Must be green before you report done.**
- `pnpm --filter @scheduler/api test` / `test:unit` / `test:int`
- `pnpm --filter @scheduler/web test`
- `pnpm db:up` (embedded Postgres 18 on :54329, data in `.pgdata/`) → `pnpm db:migrate` → `pnpm db:seed`
- `pnpm dev` — api on :3000, web on :5173

## Layout
- `packages/contracts` — zod schemas, enums, URL paths, fixtures. **Opus-owned. Import, never edit.**
- `apps/api` — Fastify 5 + fastify-type-provider-zod + Drizzle + Postgres. `src/domain/**` is pure (no I/O, no Date).
- `apps/web` — React 19 + Vite + TanStack Query + React Router 7 + MSW for mocks. CSS modules + tokens.
- `design/screens/*.html` — the visual source of truth (inline styles, template directives).

## Hard rules
1. Only touch files your work package **Owns**. Need something elsewhere → stop and report it.
2. `docs/SPEC.md`, `packages/contracts/**`, `apps/api/src/domain/availability/types.ts`, `apps/api/src/domain/errors.ts`,
   `apps/api/src/clock.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/types/**`, `apps/api/src/services/day-plan.ts`,
   `pnpm-workspace.yaml` are Opus-owned: read-only for agents.
3. SPEC gap or contradiction → report it, do not invent behaviour.
4. No new dependencies beyond those already in the package.json files, unless your brief lists them.
5. Business time comes from `app.clock` (never `new Date()` for decisions). Times inside `src/domain/availability` are
   integer minutes since local midnight.
6. Domain failures: `throw new DomainError(code, status, message, extras)` from `src/domain/errors.ts`.
7. Tests: name SPEC test-table cases by id (`it('T5 …')`). Integration tests run against real Postgres
   (embedded, started by the test helper) — never mock the database in integration tests.
8. ESM everywhere; relative imports end in `.js`; `import type` for types.
9. When done, commit on your worktree branch (`git add -A && git commit -m "<WP id>: …"`). Never push, never merge,
   never rebase `main`. Opus reviews and merges.

## Final report (always)
Summary · Acceptance criteria (✅/❌ + evidence) · Assumptions made · Deviations / open questions · Files changed.

## Project router
Agents also read `AGENT.md` (router table, forbidden paths, check commands). Project agents in `.claude/agents/`: `backend-dev`, `frontend-dev`, `db-architect` (opus, every DB change), `sched-qa`.
