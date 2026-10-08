# Brief W3-A5 — Observability (metrics, tracing, log correlation)

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §6 and §6.1, the A5 section of
`docs/PLAN.md`, `apps/api/src/{app,server}.ts`, `src/plugins/**`, and `src/services/booking.ts` (to see where outcomes are
decided). Run `pnpm install` first.

## Goal
Make the booking system observable the way an on-call engineer at a dealership group would need: is booking healthy, why are
requests failing, where is time spent — without coupling business code to a vendor.

## You own
- `apps/api/src/observability/**` (new), `apps/api/src/instrumentation.ts` (new)
- `apps/api/test/int/observability.test.ts`, `apps/api/test/unit/observability*.test.ts`
- Minimal hooks, listed in your report, in: `src/app.ts` (register metrics plugin + `/metrics`), `src/server.ts`
  (import instrumentation first), `src/services/booking.ts` and `src/services/availability.ts` (record outcomes/durations
  through a small interface — no prom-client imports in services). Another agent (A7) may edit `server.ts` concurrently: keep
  your change small.
- `docker-compose.yml` only if the Jaeger service needs a fix; `.env.example` for new variables.

Allowed new deps (add with pnpm in `apps/api` only): `@opentelemetry/api`, `@opentelemetry/sdk-node`,
`@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-pg`,
`@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@fastify/otel` (or `@opentelemetry/instrumentation-fastify`
if that is the maintained option — justify in the report). `prom-client` is already installed.

## Deliverables
1. **Metrics** (`prom-client`, own registry, default process metrics): `GET /metrics` (text format, excluded from Swagger).
   - `http_request_duration_seconds{method,route,status_code}` histogram (route = Fastify route pattern, never the raw URL).
   - `booking_attempts_total{outcome,reason,channel}` counter — outcome ∈ `created|replayed|rejected|invalid`; reason = error
     code or slot status (`none` on success).
   - `booking_reserve_duration_seconds` histogram (transaction wall time incl. lock wait) and
     `booking_lock_wait_seconds` histogram (time to acquire the advisory lock) — the two numbers that reveal contention.
   - `availability_compute_duration_seconds{same_day}` histogram.
   - `no_show_released_total` counter — expose a function A7's sweeper can call later; wire it only if A7's code is already on `main`.
2. **Tracing** (OpenTelemetry Node SDK) in `instrumentation.ts`, enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set
   (no-op otherwise, zero cost in tests); `service.name=scheduler-api`; http + fastify + pg auto-instrumentation; manual spans
   `availability.compute` and `booking.reserve` (attributes: dealership id, service code, channel, outcome — no customer PII).
3. **Log correlation:** when a span is active, pino log lines carry `trace_id`/`span_id` next to `reqId`. Booking outcome logs
   at `info` with `{ dealershipId, serviceTypeCode, channel, outcome, reason, durationMs }`.
4. **Docs:** a short `docs/observability.md` — what each metric answers, 3 example PromQL queries (booking success rate, p95
   reserve time, top rejection reasons), suggested alerts (success rate drop, lock-wait p95, 5xx), how to run Jaeger via
   `docker compose --profile obs up` and set the env var.

## Acceptance criteria
- [ ] `/metrics` test: after one successful booking and one 409, `booking_attempts_total` shows `outcome="created"` and
      `outcome="rejected",reason="NO_QUALIFIED_TECHNICIAN"` (or whichever status the setup produces); histograms have counts.
- [ ] Route label uses the pattern (`/api/v1/appointments/:reference`), not concrete references (test it).
- [ ] With `OTEL_EXPORTER_OTLP_ENDPOINT` unset the SDK is not started (test or assertion); with an in-memory span exporter in a
      unit test, a booking produces a `booking.reserve` span with the expected attributes.
- [ ] No prom-client / OTel imports in `src/services/**` or `src/domain/**` (grep in report).
- [ ] `pnpm verify` green **and exit code 0** (check `$?`).

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
