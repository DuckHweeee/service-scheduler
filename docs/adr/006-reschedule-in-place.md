# ADR-006 — Reschedule updates the appointment in place

**Status:** accepted (2026-10-12)

**Context.** Customers need to move an upcoming appointment to another date or time (S7). The move must obey every
booking rule (full-duration bay + qualified technician, vehicle overlap, same-day express policy, parts) and must never
leave a window where the customer holds neither the old nor the new slot — or both.

**Decision.** `POST /appointments/{ref}/reschedule` **updates the same row**: the reference, history, customer, vehicle,
dealership and service stay; date, time, technician, bay and channel change. Scope is limited to the same dealership and
service (another dealership or service is a new booking).

1. **Lock both days, in order.** Take `pg_advisory_xact_lock` for the old and the new dealership-day, sorted by key (one
   lock when they are equal). A fixed order means two crossing reschedules (A: day 1 → day 2, B: day 2 → day 1) cannot
   deadlock, and every booking or reschedule touching either day is serialised with this one.
2. **Re-check as if the appointment were gone.** The day plan is loaded with `excludeAppointmentId`: its own bay,
   technician, same-day quota share and vehicle window count as free. Moving 10:00 → 10:30 for a 2-hour job is therefore
   allowed, and the engine stays pure (exclusion happens where busy intervals are read).
3. **One guarded `UPDATE`.** `WHERE id = … AND status = 'CONFIRMED' AND checked_in_at IS NULL`; zero rows means a cancel,
   check-in or no-show committed first → 409. The exclusion constraints compare the new range with *other* rows only, so
   no schema change is needed and they remain the last line of defence (`23P01` → 409).
4. **Parts follow the channel.** Advance → same-day reserves parts with the same conditional `UPDATE` as booking;
   same-day → advance releases them; same-day → same-day keeps the existing reservation (and the parts check is treated
   as passed, since this appointment already holds the stock).
5. **Audit.** One `APPOINTMENT_RESCHEDULED` event with `from` and `to`; failures write `CHECK_FAILED` after rollback,
   like booking.

**Alternatives considered.** Cancel + create a new appointment linked to the old one: reuses `createAppointment`
unchanged, but the customer gets a new reference, history splits across two records, and there is a gap between the
two transactions in which the old slot is released and the new one can be lost. Holding a row lock on the appointment
(`SELECT … FOR UPDATE`) instead of the guarded update: equivalent here, but the guarded update matches how cancel,
check-in and the no-show sweeper already race safely.

**Consequences.** Reschedule cost is one extra advisory lock in the cross-day case. The reference keeps its original
date prefix (`APT-20261008-…` may now be on 9 Oct) — the reference is an identifier, not a date field. Proven by
integration tests R1–R15 (SPEC §6.5), including 20 parallel reschedules into one slot and crossing reschedules.
