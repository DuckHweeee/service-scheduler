# AGENT.md — shared rules for project agents

Every project agent reads this file first, then `CLAUDE.md` (hard rules, ownership list), `docs/SPEC.md`, and its work package in `docs/PLAN.md` / `docs/agent-briefs/`.

## Project router (check commands by change type)
| Change | Tier | Check command |
|---|---|---|
| `apps/api/src` (non Opus-owned), unit/int tests | L2 | `pnpm --filter @scheduler/api typecheck && pnpm --filter @scheduler/api test` |
| `apps/web` | L2 | `pnpm --filter @scheduler/web typecheck && pnpm --filter @scheduler/web test && pnpm --filter @scheduler/web build` |
| Migrations / `apps/api/src/db` / `apps/api/drizzle` | L3 | `pnpm verify` (planner → db-architect → reviewer) |
| API shape, `packages/contracts`, `src/domain/availability` | L3 | `pnpm verify && pnpm e2e` (Opus-owned: report, don't edit) |
| `.github/workflows`, `.env*`, `.pgdata/` | L4 | Opus only / ask the user |
| Anything before reporting done | — | `pnpm verify` must be green |

## Forbidden paths (read-only for agents)
`docs/SPEC.md`, `packages/contracts/**`, `apps/api/src/domain/availability/types.ts`, `apps/api/src/domain/errors.ts`, `apps/api/src/clock.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/types/**`, `apps/api/src/services/day-plan.ts`, `pnpm-workspace.yaml`, `.env*`, `.pgdata/`, `.github/workflows/**`.

## Always
- Edit only the directories your agent owns; need more → stop and report.
- Run the check command before reporting. Commit on the worktree branch; never push, merge, or rebase `main`.
- Final report: Summary · Acceptance criteria (✅/❌ + evidence) · Assumptions · Deviations/open questions · Files changed. Keep it short.
