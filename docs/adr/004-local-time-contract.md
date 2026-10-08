# ADR-004 — Local-time API contract with tz-aware storage

**Status:** accepted (2026-10-08)

**Decision.** Requests carry the dealership-local `date` (`YYYY-MM-DD`) and `startTime` (`HH:mm`). The server resolves them
with the dealership's IANA timezone, stores `timestamptz`, and returns both the local fields and ISO 8601 instants with
offset. The availability engine works purely in integer minutes since local midnight.

**Why.** A customer books "13:00 at Northside", not an instant; the browser's timezone is irrelevant and often wrong.
Keeping tz conversion in one module (`src/domain/time.ts`) makes DST and offset handling testable in one place.
