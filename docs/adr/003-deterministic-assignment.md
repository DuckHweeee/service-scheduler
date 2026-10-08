# ADR-003 — Deterministic resource assignment

**Status:** accepted (2026-10-08)

**Decision.** The customer picks a time; the system picks the bay and technician:
- Technician: fewest skills first (keep multi-skilled specialists free for jobs only they can do), then fewest busy minutes
  that day (balance load), then id.
- Bay: earliest position in the service's `allowedBayTypes` preference list (an oil change prefers a general lift over the
  alignment rack), then id.

**Why deterministic.** Same inputs → same assignment, so the availability preview, the booking transaction and the tests
agree. Smarter optimisation (e.g. look-ahead to maximise remaining capacity) is future work behind the same interface.
