# ADR-005 — Same-day express booking policy

**Status:** accepted (2026-10-08) — rules provided by the product owner (Huy).

**Context.** Same-day booking is valuable but can disrupt the workshop: long jobs, missing parts, customers arriving late.

**Decision.**
- Only *express* services (oil change, inspection, air filter, tire rotation, car wash) are bookable for today.
- Minimum lead time (default 120 min): earliest start is now + lead, rounded up to the 30-minute grid.
- Quota: at most `max(1, floor(bays × 20%))` concurrent same-day jobs, keeping most capacity for advance bookings and walk-ins.
- Parts: a same-day slot opens only if the dealership's stock covers the vehicle-specific parts; booking reserves them atomically
  (`CHECK (reserved <= on_hand)` guards against overselling).
- Instant confirmation: no manual approval.
- Late arrival: same-day bookings not checked in within 15 minutes of start become `NO_SHOW` and release bay, technician and parts.

**Consequences.** Policy is per-dealership configuration (`same_day_lead_min`, `same_day_quota_pct`, `late_grace_min`).
The pure policy function `evaluateSameDay` is unit-tested independently of the database. Inventory is a local table plus an
update endpoint standing in for a DMS stock feed.
