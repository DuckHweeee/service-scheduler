# Observability

The API exposes Prometheus metrics at `GET /metrics`, emits OpenTelemetry traces when an OTLP endpoint is configured, and
correlates log lines with traces. Business code (`src/services/**`, `src/domain/**`) only talks to the vendor-free
`Telemetry` interface in `src/observability/telemetry.ts`; prom-client and OpenTelemetry live in `src/observability/**`
and `src/instrumentation.ts`.

## Metrics

| Metric | Labels | Answers |
|---|---|---|
| `http_request_duration_seconds` | `method`, `route`, `status_code` | Is the API fast and error-free? `route` is the Fastify pattern (`/api/v1/appointments/:reference`), never the raw URL. `/metrics` itself is not recorded. |
| `booking_attempts_total` | `outcome` (`created`/`replayed`/`rejected`/`invalid`), `reason`, `channel` (`ADVANCE`/`SAME_DAY`/`unknown`) | Is booking healthy, and why do attempts fail? `reason` is `none` on success, else the slot status (`NO_BAY`, `NO_QUALIFIED_TECHNICIAN`, ...) for `SLOT_UNAVAILABLE`, else the error code. `rejected` = 409 (business conflict), `invalid` = other 4xx, unexpected errors count as `rejected` / `INTERNAL_ERROR`. |
| `reschedule_attempts_total` | `outcome` (`rescheduled`/`unchanged`/`rejected`/`invalid`), `reason` | Same idea for reschedules (SPEC §6.5). `unchanged` = target equals the current slot (no-op 200). No customer, vehicle or reference labels. |
| `booking_reserve_duration_seconds` | | Wall time of the booking (or reschedule) transaction, lock wait included. |
| `booking_lock_wait_seconds` | | Time to acquire the per-(dealership, day) advisory lock(s); a cross-day reschedule takes two. Reserve time rising together with lock wait means contention on a busy day, not slow queries. |
| `availability_compute_duration_seconds` | `same_day` | Cost of the availability read model. |
| `no_show_released_total` | | Same-day appointments released as no-shows (by the sweeper or by a late check-in). |
| `process_*`, `nodejs_*` | | Default Node process metrics. |

### Example PromQL

```promql
# Booking success rate (created + replayed over all attempts that were not client errors), 5m
sum(rate(booking_attempts_total{outcome=~"created|replayed"}[5m]))
  / sum(rate(booking_attempts_total{outcome!="invalid"}[5m]))

# p95 reserve transaction time
histogram_quantile(0.95, sum by (le) (rate(booking_reserve_duration_seconds_bucket[5m])))

# Top rejection reasons, last hour
topk(5, sum by (reason) (increase(booking_attempts_total{outcome="rejected"}[1h])))
```

### Suggested alerts

- Booking success rate below 70% for 15m (a sudden drop usually means a capacity or data problem, e.g. a technician or parts outage).
- `histogram_quantile(0.95, sum by (le) (rate(booking_lock_wait_seconds_bucket[5m])))` above 250ms for 10m (lock contention).
- 5xx ratio: `sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m])) > 0.01` for 5m.

## Tracing

Tracing is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set (no SDK is started, zero cost). When set, the Node SDK starts with
`service.name=scheduler-api`, HTTP, Fastify (`@fastify/otel`, the maintained official plugin) and `pg` auto-instrumentation, and
exports OTLP/HTTP to `<endpoint>/v1/traces`. Manual spans: `availability.compute`, `booking.reserve` and
`booking.reschedule` (attributes `dealership.id`, `service.code`, `booking.channel`, `booking.outcome`, `booking.reason`;
no customer data).

Run Jaeger locally:

```bash
docker compose --profile obs up -d jaeger
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev   # UI: http://localhost:16686
```

**Sampling.** The SDK honours the standard `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` variables. Without them
every trace is kept (fine for a single developer). The compose `api` service defaults to
`OTEL_TRACES_SAMPLER=parentbased_traceidratio` and `OTEL_TRACES_SAMPLER_ARG=0.1` (10% of new traces): at 100% under the
load test Jaeger's in-memory store was OOM-killed ([`performance.md`](performance.md#observed-during-the-work)). To trace
everything in a demo: `OTEL_TRACES_SAMPLER_ARG=1`. Jaeger itself is capped (`mem_limit: 1g`, `MEMORY_MAX_TRACES=20000`).

## Prometheus and Grafana (Docker)

The compose `obs` profile runs Prometheus (scrapes `api:3000/metrics` every 5 s, [`ops/prometheus.yml`](../ops/prometheus.yml),
2-day retention), a provisioned Grafana and Jaeger. Start it together with the containerised app so Prometheus can reach
the API:

```bash
docker compose --profile app --profile obs up -d --build
# with tracing into Jaeger:
OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318 docker compose --profile app --profile obs up -d --build
```

| UI | URL | Notes |
|---|---|---|
| Grafana | http://localhost:3001 | anonymous viewer; the **Service Scheduler** dashboard is the home page; Prometheus and Jaeger datasources are provisioned (admin login `admin` / `admin`) |
| Prometheus | http://localhost:9090 | target `api` should be `up` under *Status → Targets* |
| Jaeger | http://localhost:16686 | only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set for the API |

Host ports can be moved with `GRAFANA_PORT` and `PROMETHEUS_PORT` (Jaeger's 16686/4318 are fixed).

Dashboard panels ([`ops/grafana/dashboards/scheduler.json`](../ops/grafana/dashboards/scheduler.json)):

| Panel | Query (abridged) |
|---|---|
| Booking attempts by outcome (req/s) | `sum by (outcome) (rate(booking_attempts_total[…]))` |
| Booking attempts by reason (req/s) | `sum by (outcome, reason) (rate(booking_attempts_total{reason!="none"}[…]))` |
| Reschedule attempts by outcome (req/s) | `sum by (outcome) (rate(reschedule_attempts_total[…]))` |
| No-show releases | rate and total of `no_show_released_total` |
| Reserve transaction duration p50 / p95 | `histogram_quantile` over `booking_reserve_duration_seconds_bucket` |
| Advisory lock wait p95 (and p50) | `histogram_quantile` over `booking_lock_wait_seconds_bucket` |
| Availability compute p95 by same_day | `histogram_quantile` over `availability_compute_duration_seconds_bucket` by `same_day` |
| HTTP p95 by route | `histogram_quantile` over `http_request_duration_seconds_bucket` by `route` |
| HTTP requests by status class / by route (req/s) | `rate(http_request_duration_seconds_count[…])` |

A screenshot of the dashboard during the k6 load test is in [`performance.md`](performance.md#grafana) (the reschedule panel
is empty there because the load test only books).

## Logs

Every pino line carries `reqId`; when a span is active it also carries `trace_id` and `span_id`. Each booking attempt logs one
`info` line: `{ dealershipId, serviceTypeCode, channel, outcome, reason, durationMs }`.
