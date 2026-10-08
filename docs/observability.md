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
| `booking_reserve_duration_seconds` | | Wall time of the booking transaction, lock wait included. |
| `booking_lock_wait_seconds` | | Time to acquire the per-(dealership, day) advisory lock. Reserve time rising together with lock wait means contention on a busy day, not slow queries. |
| `availability_compute_duration_seconds` | `same_day` | Cost of the availability read model. |
| `no_show_released_total` | | Appointments released by the no-show sweeper (`Telemetry.noShowReleased(n)`; not yet called, see below). |
| `process_*`, `nodejs_*` | | Default Node process metrics. |

`no_show_released_total` is exposed through `getTelemetry().noShowReleased(count)`; wire it in the sweeper once it exists.

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
exports OTLP/HTTP to `<endpoint>/v1/traces`. Manual spans: `availability.compute` and `booking.reserve`
(attributes `dealership.id`, `service.code`, `booking.channel`, `booking.outcome`, `booking.reason`; no customer data).

Run Jaeger locally:

```bash
docker compose --profile obs up -d jaeger
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 pnpm dev   # UI: http://localhost:16686
```

## Logs

Every pino line carries `reqId`; when a span is active it also carries `trace_id` and `span_id`. Each booking attempt logs one
`info` line: `{ dealershipId, serviceTypeCode, channel, outcome, reason, durationMs }`.
