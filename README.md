# Unified Service Scheduler

Keyloop technical assessment — **Scenario A**. Service appointment booking that only confirms a time when a service bay
**and** a qualified technician are both free for the whole job, with same-day express booking.

> Work in progress. See [`docs/PLAN.md`](docs/PLAN.md) for the delivery plan and [`docs/SPEC.md`](docs/SPEC.md) for the
> contract. Full build/run/test instructions and the AI Collaboration Narrative land in Wave 4.

## Quick start (no Docker needed)

```bash
corepack enable            # provides pnpm 10
pnpm install
pnpm db:up                 # embedded PostgreSQL 18 on :54329 (keep running)
pnpm db:migrate && pnpm db:seed
pnpm dev                   # API :3000 (Swagger at /docs) · web :5173
pnpm verify                # typecheck + lint + tests
```
