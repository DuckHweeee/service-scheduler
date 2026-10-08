# ADR-001 — Backend is the fully implemented layer; web is a client harness

**Status:** accepted (2026-10-08)

**Context.** The challenge asks for one layer implemented fully and the other mocked. Scenario A's hard problems —
checking a bay *and* a qualified technician for the whole duration, and never double-booking under concurrency —
live in the backend. We also have a high-fidelity UI design.

**Decision.** Implement the backend fully (REST, Postgres, tests at unit + integration level, observability).
Build the web app from the design as a *client harness*: it runs against MSW mocks during development and against
the real API for the demo, with component tests for its state logic and one Playwright smoke suite.

**Consequences.** Test depth is concentrated where correctness matters. The web adds demo value without claiming
to be the evaluated layer. Shared zod contracts keep both sides in lockstep.
