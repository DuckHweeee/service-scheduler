# Brief W6-O1 — Containers, observability stack, load test (backend-dev)

Read first: `AGENT.md`, `CLAUDE.md`, `docs/observability.md`, `apps/api/src/observability/metrics.ts`,
`docker-compose.yml`, `.env.example`, `apps/api/src/config.ts`, `apps/api/scripts/{seed,migrate}.ts`,
`e2e/support/global-setup.ts` (how the stack is started without Docker). Run `pnpm install`.

Machine: **Mac mini M4 (arm64) with Docker** — verify everything locally. CI runs linux/amd64, so images must build
on both: multi-arch official base images only, no arch-specific digests or binaries.

## Goal
`docker compose --profile app up --build` gives a reviewer the whole system (Postgres → migrate + seed → API → web)
with no Node toolchain; `--profile obs` adds Jaeger, Prometheus and a provisioned Grafana dashboard; a k6 load test
produces numbers that prove the booking invariants hold under load.

## Owns
- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/nginx.conf`, `.dockerignore`
- `docker-compose.yml` (keep the existing `postgres` service working exactly as today for `docker compose up -d postgres`)
- `ops/**` (new: `prometheus.yml`, `grafana/provisioning/**`, `grafana/dashboards/scheduler.json`)
- `loadtest/**` (new: `seed-load.ts`, `booking.js`, `verify-invariants.sql`, `README.md`)
- `docs/performance.md` (new), `docs/screenshots/grafana.png` (new)
- Root `package.json`: scripts only (e.g. `loadtest:seed`)

Not yours: `.github/workflows/**` (Opus), `README.md` / `docs/SYSTEM_DESIGN.md` (D2 — put the run instructions you want
there in your report), any `apps/*/src/**` (stop and report if the app needs a change to run in a container).

## Deliverables
1. **API image:** multi-stage on `node:22-slim`, corepack pnpm, `pnpm install --frozen-lockfile` with the workspace
   filter for `@scheduler/api...`, runs `pnpm --filter @scheduler/api start` (tsx, same as today). Non-root user,
   `HEALTHCHECK` on `/health/ready`, `NODE_ENV=production`.
2. **Web image:** build stage runs `vite build` with build args `VITE_API_URL` (default `http://localhost:3000`),
   `VITE_USE_MOCKS=false`, `VITE_CUSTOMER_ID`; serve with `nginx:alpine`, SPA fallback to `index.html`.
3. **Compose profile `app`:** `postgres` (healthcheck) → `migrate` one-shot (api image, runs `db:migrate` then `db:seed`,
   `depends_on: service_completed_successfully`) → `api` (healthy) → `web` on :5173. `CLOCK_OVERRIDE` passthrough from the
   host env for demos. `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318` set only when `obs` is up (document how).
4. **Compose profile `obs`:** Jaeger (existing), Prometheus (scrapes `api:3000/metrics` every 5 s), Grafana on :3001
   with anonymous viewer access and the dashboard provisioned. Panels: booking attempts by outcome and reason (rate),
   reschedule attempts by outcome (the metric `reschedule_attempts_total` lands with W5-A8 — include the panel either
   way), reserve duration p50/p95, advisory lock wait p95, availability compute p95 split by same-day, HTTP p95 by route,
   no-show releases. Use the metric names exactly as in `metrics.ts`.
5. **Load test:**
   - `loadtest/seed-load.ts`: adds N customers each with one ICE vehicle (deterministic ids `LT-CUS-0001…`), so
     contention is about bays/technicians, not `VEHICLE_ALREADY_BOOKED`. Idempotent.
   - `loadtest/booking.js` (k6): scenario `browse` — constant arrival rate on availability for DLR-01/02 over the next
     working days; scenario `contend` — VUs pick a random load customer, fetch availability, book the first AVAILABLE
     slot (unique `bookingSessionId`, no idempotency key), treat 409 as an expected outcome. Thresholds: `http_req_failed`
     counts only 5xx/network errors → rate 0; p95 thresholds set after the first run and recorded.
     Custom counters for 201 / 409-by-code. Run with the `grafana/k6` image (`docker run --network host` or the compose
     network) — no k6 in package.json.
   - `loadtest/verify-invariants.sql`: returns one row per violation — overlapping CONFIRMED pairs per technician, per bay,
     per vehicle (`&&` on `during`), `reserved > on_hand`, and same-day appointments whose parts are not reserved. Must
     return **0 rows** after the run.
6. **`docs/performance.md`:** machine (M4, cores, Docker CPU/memory limits), dataset size, scenario config, results
   table (RPS, p50/p95/p99 for availability and booking, 201 vs 409 split, lock wait p95 from Prometheus), invariant check
   output, Grafana screenshot, and what the numbers mean (where the per-dealership-day lock serialises work).

## Acceptance criteria
- [ ] `docker compose --profile app up --build -d` from a clean state: web on :5173 books an appointment against the API;
      `/health/ready` 200. Paste `docker compose ps` output.
- [ ] `docker compose --profile app --profile obs up -d`: Prometheus target `api` is UP (paste `/api/v1/targets` health);
      Grafana dashboard shows data after the load test; `docs/screenshots/grafana.png` captured (Playwright against
      Grafana is fine).
- [ ] k6 run completes with thresholds passing; `verify-invariants.sql` returns 0 rows (paste the psql output).
- [ ] `docker compose up -d postgres` alone still works for the existing non-Docker dev path; `pnpm verify` green.
- [ ] Report lists the exact commands for README (D2) and the CI job you want (Opus writes `.github/workflows`).

Commit on your worktree branch: `W6-O1: Docker images, compose app/obs profiles, Grafana, k6 load test`.
Final report per `AGENT.md`.
