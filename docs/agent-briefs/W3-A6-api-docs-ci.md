# Brief W3-A6 — API contract docs + CI

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §6, `apps/api/src/app.ts`
(swagger setup) and the route modules in `apps/api/src/routes/`. Run `pnpm install` first.

## You own
- `apps/api/scripts/export-openapi.ts` (new) and an `openapi:export` script in **`apps/api/package.json`** (not the root one —
  another agent is editing root `package.json`)
- `docs/openapi.yaml` (generated, committed), `docs/requests.http`, `docs/curl-examples.md`
- `.github/workflows/ci.yml`

## Deliverables
1. **OpenAPI export:** build the app (no DB connection needed — use a stub `db` object; `buildApp` only decorates it), call
   `app.ready()`, write `app.swagger({ yaml: true })` to `docs/openapi.yaml`. Before writing, enrich the document's `info`
   (title, version, description: one paragraph on the double-booking guarantee and same-day policy) and `tags` if that can be
   done from the script without editing route files. Check the result: every SPEC §6 endpoint present with request and 200/201
   response schemas. If error responses are missing from the spec, add a reusable `Problem` component and reference it for
   4xx in the exported document (post-processing in the script is fine) — list what you did.
2. **`docs/requests.http`** (VS Code REST Client / JetBrains HTTP client): a runnable walkthrough against `http://localhost:3000`
   — reference data, availability (future day, same-day, blocked same-day), book, conflict (same slot twice → 409 with
   alternatives), idempotent replay, detail with history, cancel, check-in, inventory set to 0 then same-day parts block,
   board, metrics.
3. **`docs/curl-examples.md`:** the same flow as copy-paste cURL with short expected-response notes, plus how to pin the clock
   (`CLOCK_OVERRIDE`) so same-day examples work at any time of day.
4. **CI** (`.github/workflows/ci.yml`): on push and PR to `main`, `ubuntu-latest`, Node 22, pnpm via corepack, cached store,
   `pnpm install --frozen-lockfile`, `pnpm verify`. (Embedded Postgres has linux-x64 binaries; the root
   `pnpm-workspace.yaml` already allows their install script.) Add `pnpm --filter @scheduler/web build`. Do not add e2e to CI.
   You cannot run GitHub Actions here: validate the YAML syntax locally and dry-run the same commands in a clean clone of
   your worktree (`git clone <worktree> /tmp/x && cd /tmp/x && corepack pnpm install --frozen-lockfile && pnpm verify`)
   and report the exit codes.

## Acceptance criteria
- [ ] `pnpm --filter @scheduler/api openapi:export` regenerates `docs/openapi.yaml` deterministically (run twice → no diff).
- [ ] Every SPEC §6 route appears; each 4xx response references a Problem schema.
- [ ] `requests.http` / cURL flow verified against a running API (`pnpm db:up`, `pnpm db:migrate && pnpm db:seed`, `pnpm
      --filter @scheduler/api dev`) — paste the status codes you observed. Note: another process may already hold port 54329;
      if so, use the running instance or start yours on another port via env.
- [ ] Clean-clone dry run of the CI commands exits 0.
- [ ] `pnpm verify` exit 0.

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
