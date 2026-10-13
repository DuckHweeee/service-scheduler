# Unified Service Scheduler — Technical Spec (the contract)

Status: **v0.3.1 — locked for Wave 6** (v0.2 added same-day express booking; v0.3 adds reschedule, §6.5; v0.3.1 = §8
plain-language copy and flow rules from the W6 web review). Owner: Huy + Opus.
Sonnet agents implement against this document and must not change it. If a spec gap blocks you, stop and
report it; do not invent.

Source material: `KeyloopCodingChallange.pdf` (Scenario A) and `design/screens/*.html`.

---

## 1. Scope

| # | Requirement | Where |
|---|---|---|
| R1 | Request an appointment for a vehicle, service type, dealership and desired time | `POST /appointments`, Book screen |
| R2 | Before confirming, verify a **ServiceBay** and a **qualified Technician** are both free for the **entire** duration | Availability engine + booking transaction |
| R3 | On success, persist an Appointment linking customer, vehicle, technician and bay | `appointments` table |
| S1 | On conflict, offer up to 5 alternative slots | 409 body |
| S2 | Booking history (audit trail) per appointment | `booking_events` |
| S3 | Service board: day timeline per bay and technician | `GET /dealerships/{id}/board` |
| S4 | My appointments list and cancellation | `GET /appointments`, `POST /appointments/{ref}/cancel` |
| S5 | **Same-day express booking** with lead time, quota, parts check, instant confirmation | §5.5, §6.2 |
| S6 | **Late-arrival policy** for same-day bookings (check-in, auto no-show) | §6.3 |
| S7 | **Reschedule** an upcoming appointment in place (same reference, same dealership and service) | §6.5 |

**Out of scope (future work):** authentication/authorisation, notifications, technician
shifts/absences, buffers between jobs, multi-day jobs, payments, walk-in queue management, live DMS inventory
integration (v1 has a local inventory table plus an update endpoint standing in for the sync), the
"incoming request / rejected / reserved" panels on the board mock.

## 2. Assumptions & decisions (copy into the System Design Document)

- A1. **No auth.** The web app acts as customer `CUS-10482` (config `VITE_CUSTOMER_ID`). The service board is
  an advisor view reachable without login.
- A2. All dealership times are **local to the dealership's IANA timezone** (seed: `Asia/Ho_Chi_Minh`, UTC+7,
  no DST). DB stores `timestamptz`. API inputs use local `date` + `startTime`; outputs include ISO 8601 with offset.
- A3. Dealerships open **08:00–17:00, Mon–Fri**. A job must **start and finish inside opening hours** on one day.
- A4. Slot grid = **30 minutes** from opening time. Durations need not be multiples of 30.
- A5. Intervals are **half-open `[start, end)`**: back-to-back jobs are allowed. No buffer between jobs.
- A6. A technician works all opening hours of their dealership. Technicians and bays belong to one dealership.
- A7. Booking horizon: **today … today + 30 days** (dealership-local). Today = same-day channel (§5.5).
- A8. A vehicle cannot have two overlapping confirmed appointments (anywhere).
- A9. The system **assigns** bay and technician; the customer chooses only the time (§5.3).
- A10. Cancelling frees resources and reserved parts immediately. Only future `CONFIRMED` appointments can be cancelled.
- A11. Every booking is **auto-confirmed** (instant confirmation) — there is no manual approval step.
- A12. Parts are checked and reserved **only for same-day bookings**; advance bookings assume parts can be ordered
  in time.
- A13. A service only applies to vehicles whose powertrain is in `service_types.powertrains` (no oil change on an EV).
- A14. The server clock is injectable; `CLOCK_OVERRIDE=<ISO>` pins "now" for demos and tests.

## 3. Domain model

```
Customer 1─* Vehicle (powertrain)
Dealership 1─* ServiceBay (bayType)          Dealership 1─* Technician (skills[])
Dealership 1─* InventoryItem (sku, onHand, reserved)
ServiceType (durationMin, requiredSkill, allowedBayTypes[], isExpress, powertrains[]) 1─* PartRequirement (per vehicle model)
Appointment *─1 Customer, Vehicle, Dealership, ServiceType, Technician, ServiceBay; 1─* AppointmentPart
Appointment 1─* BookingEvent (via bookingSessionId / appointmentId)
```

Enums:

- `Skill`: `GENERAL | BRAKES | ALIGNMENT | EV_HIGH_VOLTAGE`
- `BayType`: `GENERAL_LIFT | ALIGNMENT_RACK | EV_ISOLATED | WASH_BAY`
- `Powertrain`: `ICE | EV`
- `AppointmentStatus`: `CONFIRMED | CANCELLED | NO_SHOW`
- `BookingChannel`: `ADVANCE | SAME_DAY`
- `SlotStatus`: `AVAILABLE | NO_QUALIFIED_TECHNICIAN | NO_BAY | FULLY_BOOKED | SAME_DAY_QUOTA_REACHED`
- `SameDayBlock`: `SERVICE_NOT_EXPRESS | PARTS_UNAVAILABLE | PAST_CUTOFF`
- `BookingEventType`: `SLOT_REQUESTED | CHECK_FAILED | CHECK_PASSED | RESOURCES_RESERVED | APPOINTMENT_CREATED |
  APPOINTMENT_CANCELLED | CHECKED_IN | APPOINTMENT_NO_SHOW`

## 4. Database (PostgreSQL 18)

Migrations live in `apps/api/drizzle/`. Drizzle cannot express `EXCLUDE`; constraints below are a
hand-written SQL migration. **The exclusion constraints are the final guarantee against double booking.**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TYPE skill AS ENUM ('GENERAL','BRAKES','ALIGNMENT','EV_HIGH_VOLTAGE');
CREATE TYPE bay_type AS ENUM ('GENERAL_LIFT','ALIGNMENT_RACK','EV_ISOLATED','WASH_BAY');
CREATE TYPE powertrain AS ENUM ('ICE','EV');
CREATE TYPE appointment_status AS ENUM ('CONFIRMED','CANCELLED','NO_SHOW');
CREATE TYPE booking_channel AS ENUM ('ADVANCE','SAME_DAY');

CREATE TABLE dealerships (
  id text PRIMARY KEY,                 -- 'DLR-01'
  name text NOT NULL,
  timezone text NOT NULL,              -- IANA
  opens_at time NOT NULL,              -- 08:00
  closes_at time NOT NULL,             -- 17:00
  working_days smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO weekday
  same_day_lead_min int NOT NULL DEFAULT 120,
  same_day_quota_pct int NOT NULL DEFAULT 20 CHECK (same_day_quota_pct BETWEEN 0 AND 100),
  late_grace_min int NOT NULL DEFAULT 15
);
CREATE TABLE service_bays (
  id text PRIMARY KEY, dealership_id text NOT NULL REFERENCES dealerships(id),
  name text NOT NULL, bay_type bay_type NOT NULL,
  UNIQUE (id, dealership_id)
);
CREATE TABLE technicians (
  id text PRIMARY KEY, dealership_id text NOT NULL REFERENCES dealerships(id),
  name text NOT NULL, skills skill[] NOT NULL,
  UNIQUE (id, dealership_id)
);
CREATE TABLE service_types (
  code text PRIMARY KEY, name text NOT NULL,
  duration_min int NOT NULL CHECK (duration_min > 0),
  required_skill skill NOT NULL,
  allowed_bay_types bay_type[] NOT NULL,         -- preference order matters
  is_express boolean NOT NULL DEFAULT false,
  powertrains powertrain[] NOT NULL DEFAULT '{ICE,EV}'
);
CREATE TABLE customers (id text PRIMARY KEY, full_name text NOT NULL, phone text, email text);
CREATE TABLE vehicles (
  id text PRIMARY KEY, customer_id text NOT NULL REFERENCES customers(id),
  model_year int NOT NULL, model_name text NOT NULL, powertrain powertrain NOT NULL,
  vin char(17) NOT NULL UNIQUE, plate text
);
CREATE TABLE parts (sku text PRIMARY KEY, name text NOT NULL);
CREATE TABLE service_part_requirements (
  service_type_code text NOT NULL REFERENCES service_types(code),
  vehicle_model text,                              -- NULL = applies to any model without a specific row
  sku text NOT NULL REFERENCES parts(sku), qty int NOT NULL CHECK (qty > 0)
);
CREATE TABLE inventory (
  dealership_id text NOT NULL REFERENCES dealerships(id), sku text NOT NULL REFERENCES parts(sku),
  on_hand int NOT NULL CHECK (on_hand >= 0), reserved int NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dealership_id, sku), CHECK (reserved <= on_hand)
);
CREATE SEQUENCE appointment_ref_seq;
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,                 -- 'APT-20261008-0409'
  status appointment_status NOT NULL DEFAULT 'CONFIRMED',
  channel booking_channel NOT NULL,
  customer_id text NOT NULL REFERENCES customers(id),
  vehicle_id text NOT NULL REFERENCES vehicles(id),
  dealership_id text NOT NULL REFERENCES dealerships(id),
  service_type_code text NOT NULL REFERENCES service_types(code),
  technician_id text NOT NULL, service_bay_id text NOT NULL,
  start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, duration_min int NOT NULL,
  booking_session_id uuid, idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_in_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  during tstzrange GENERATED ALWAYS AS (tstzrange(start_at, end_at, '[)')) STORED,
  CHECK (end_at > start_at),
  FOREIGN KEY (technician_id, dealership_id) REFERENCES technicians(id, dealership_id),
  FOREIGN KEY (service_bay_id, dealership_id) REFERENCES service_bays(id, dealership_id),
  CONSTRAINT no_technician_overlap EXCLUDE USING gist (technician_id WITH =, during WITH &&) WHERE (status = 'CONFIRMED'),
  CONSTRAINT no_bay_overlap        EXCLUDE USING gist (service_bay_id WITH =, during WITH &&) WHERE (status = 'CONFIRMED'),
  CONSTRAINT no_vehicle_overlap    EXCLUDE USING gist (vehicle_id WITH =, during WITH &&) WHERE (status = 'CONFIRMED')
);
CREATE INDEX appointments_dealership_start ON appointments (dealership_id, start_at);
CREATE INDEX appointments_customer_start ON appointments (customer_id, start_at);
CREATE TABLE appointment_parts (
  appointment_id uuid NOT NULL REFERENCES appointments(id), sku text NOT NULL REFERENCES parts(sku),
  qty int NOT NULL CHECK (qty > 0), released_at timestamptz,
  PRIMARY KEY (appointment_id, sku)
);
CREATE TABLE booking_events (
  id bigserial PRIMARY KEY,
  session_id uuid, appointment_id uuid REFERENCES appointments(id),
  type text NOT NULL, detail jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_events_session ON booking_events (session_id, occurred_at);
CREATE INDEX booking_events_appointment ON booking_events (appointment_id, occurred_at);
```

**Reference format:** `APT-{YYYYMMDD of local start date}-{lpad(nextval(appointment_ref_seq) % 10000, 4)}`.

## 5. Availability engine (pure domain — the core business logic)

Location: `apps/api/src/domain/availability/`. **No I/O, no `Date`, no DB, no luxon.** Times inside the engine are
**minutes since local midnight** (integers); tz conversion happens outside (`src/domain/time.ts`).
Types are fixed in `types.ts` (written in Wave 0) — signatures below are a summary.

### 5.1 Types

```ts
type Interval = { start: number; end: number }            // minutes, half-open
type DayContext = {
  opensAt: number; closesAt: number; isWorkingDay: boolean;
  bays: { id; name; bayType: BayType; busy: Interval[] }[];
  technicians: { id; name; skills: Skill[]; busy: Interval[] }[];
  sameDay: null | { earliestStart: number; quotaCap: number; sameDayBusy: Interval[] };
}
type ServiceSpec = { code; durationMin; requiredSkill: Skill; allowedBayTypes: BayType[] }
type SlotResult = { start; end; status: SlotStatus; proposed: { bayId; technicianId } | null }
computeSlots(day, service, stepMin = 30): SlotResult[]
checkWindow(day, service, start): SlotResult
findAlternatives(days: { date; day }[], service, after: { date; start }, limit = 5): { date; slot }[]
evaluateSameDay(input: SameDayPolicyInput): { blocked: SameDayBlock | null; earliestStart: number; quotaCap: number }
sameDayQuotaCap(bayCount, quotaPct): number
```

### 5.2 Rules

1. Not a working day → `computeSlots` returns `[]`.
2. Candidate starts: `t = opensAt, opensAt+step, …` while `t + durationMin <= closesAt`.
   If `day.sameDay` is set, only `t >= sameDay.earliestStart` are candidates (earlier ones are omitted, not flagged).
3. A resource is **free** for `[t, t+d)` iff no busy interval `b` satisfies `b.start < t+d && t < b.end`.
4. Eligible bays: `bayType ∈ allowedBayTypes` and free. Eligible techs: `requiredSkill ∈ skills` and free.
5. Status: both non-empty → `AVAILABLE`; bays only → `NO_QUALIFIED_TECHNICIAN`; techs only → `NO_BAY`;
   neither → `FULLY_BOOKED`.
6. Same-day quota: if the resource status is `AVAILABLE`, `day.sameDay` is set and the number of `sameDayBusy`
   intervals overlapping `[t, t+d)` is `>= quotaCap` → `SAME_DAY_QUOTA_REACHED` (proposed = null).
7. `findAlternatives`: `AVAILABLE` slots strictly after `after`, same day first then later days in order, max `limit`.
8. `checkWindow(day, service, start)` returns exactly what `computeSlots` returns for that grid start; for a window
   outside opening hours (`start < opensAt` or `start + d > closesAt`) it returns `FULLY_BOOKED` with `proposed: null`
   (callers validate alignment/hours separately and report the specific error).

### 5.3 Assignment (deterministic; ADR-003)

- **Technician:** fewest skills first (keep specialists free), then fewest busy minutes that day, then `id` asc.
- **Bay:** lowest index in `allowedBayTypes` (preference order) first, then `id` asc.

### 5.4 Same-day policy (`evaluateSameDay`, pure)

Input: `{ isSameDay, isExpress, partsAvailable, nowMin, leadMin, opensAt, closesAt, durationMin, stepMin, bayCount, quotaPct }`.

1. `!isSameDay` → `{ blocked: null, earliestStart: opensAt, quotaCap: Infinity }` (caller passes `sameDay: null`).
2. `!isExpress` → `SERVICE_NOT_EXPRESS`.
3. `!partsAvailable` → `PARTS_UNAVAILABLE`.
4. `earliestStart` = `nowMin + leadMin` rounded **up** to the slot grid (relative to `opensAt`), never before `opensAt`.
   `nowMin` itself rounds **up** a started minute (09:30:30 → 571), so seconds never shorten the lead time.
5. `earliestStart + durationMin > closesAt` → `PAST_CUTOFF`.
6. `quotaCap = sameDayQuotaCap(bayCount, quotaPct) = max(1, floor(bayCount × quotaPct / 100))`; `quotaPct = 0` → 0
   (same-day disabled ⇒ every slot `SAME_DAY_QUOTA_REACHED`).

Check order is exactly 2 → 3 → 4/5 (first failing reason wins).

### 5.5 Required unit test table (minimum; agents may add more)

Fixture = DLR-01 seed (§7), empty day, `sameDay: null` unless stated. Times local.

| # | Case | Expect |
|---|---|---|
| T1 | Brake 120m, empty day | 15 slots 08:00…15:00, all `AVAILABLE` |
| T2 | Oil 45m, empty day | 17 slots, last starts 16:00 |
| T3 | Weekend | `[]` |
| T4 | Brake; TEC-01 busy 08:00–10:00, TEC-03 busy 08:00–10:00 | 08:00–09:30 `NO_QUALIFIED_TECHNICIAN`; 10:00 `AVAILABLE` (back-to-back) |
| T5 | Brake 10:00; TEC-01 busy 10:30–11:00, TEC-03 busy 09:00–11:00 | 10:00 → `NO_QUALIFIED_TECHNICIAN` (partial overlap rejects) |
| T6 | Alignment; BAY-03 busy all day, TEC-02 free | all `NO_BAY` |
| T7 | Alignment; BAY-03 busy all day; TEC-02 busy all day | all `FULLY_BOOKED` |
| T8 | EV check 90m; TEC-01 and TEC-04 busy 08:00–12:00 | 08:00…11:30 `NO_QUALIFIED_TECHNICIAN` (11:30–13:00 still overlaps); 12:00 `AVAILABLE` |
| T9 | Brake, empty day, assignment | tech **TEC-03** (2 skills beats TEC-01's 3), bay **BAY-01** |
| T10a | Oil 08:00, empty day | bay **BAY-01**; tech **TEC-02** (TEC-02/03/04 tie on skills and busy → id asc) |
| T10b | Oil 08:00; TEC-02 busy 16:00–17:00 | tech **TEC-03** (tie on skills → fewer busy minutes → id) |
| T11 | Oil; BAY-01, BAY-02 busy all day | bay **BAY-03** (falls back to ALIGNMENT_RACK) |
| T12 | `findAlternatives` after 10:00 with 11:00+ open | 5 slots starting 11:00, same day |
| T13 | `findAlternatives` near close | rolls over to next day's first open slots |
| T14 | Brake, job ends exactly at close | 15:00 included, 15:30 excluded |
| T15 | Same-day lead: now 09:10, lead 120 | earliestStart 11:30 (11:10 rounded up); first slot 11:30 |
| T16 | Same-day quota cap 1; one same-day job 13:00–13:45 | Oil 12:30, 13:00, 13:30 → `SAME_DAY_QUOTA_REACHED`; 12:00 and 14:00 `AVAILABLE` |
| T17 | Policy: brake today | `SERVICE_NOT_EXPRESS` |
| T18 | Policy: oil today, parts missing | `PARTS_UNAVAILABLE` |
| T19 | Policy: oil today, now 15:20, lead 120 | `PAST_CUTOFF` |
| T20 | Policy precedence: non-express **and** parts missing | `SERVICE_NOT_EXPRESS` |
| T21 | Quota cap | 5 bays×20% → 1; 10×15% → 1; 20×20% → 4; 5×0% → 0 |

## 6. REST API (`/api/v1`, JSON, zod schemas in `packages/contracts`)

All errors are RFC 7807 `application/problem+json`:
`{ type, title, status, code, detail, errors?, reason?, alternatives? }`.

| Method & path | Purpose | Success | Errors |
|---|---|---|---|
| `GET /dealerships` | list with hours, tz, bay count, same-day policy | 200 `{items}` | |
| `GET /service-types` | list (incl. `isExpress`, `powertrains`) | 200 `{items}` | |
| `GET /customers/{id}` | customer | 200 | 404 |
| `GET /customers/{id}/vehicles` | vehicles | 200 `{items}` | 404 |
| `GET /dealerships/{id}/availability?serviceType=&date=&vehicleId=` | slot grid for one day | 200 | 404, 422 `OUTSIDE_BOOKING_HORIZON` / `SERVICE_NOT_APPLICABLE` |
| `POST /appointments` | book (R1–R3, S5) | 201 `AppointmentDetail` | see §6.1 |
| `GET /appointments?customerId=&status=` | list, upcoming first | 200 `{items}` | |
| `GET /appointments/{reference}` | detail incl. linked entities + history | 200 | 404 |
| `POST /appointments/{reference}/cancel` | cancel `{reason?}` | 200 (idempotent if already cancelled) | 409 `APPOINTMENT_NOT_CANCELLABLE` |
| `POST /appointments/{reference}/check-in` | advisor check-in (S6) | 200 | 409 `LATE_ARRIVAL`, 409 `APPOINTMENT_NOT_ACTIVE` |
| `POST /appointments/{reference}/reschedule` | move to another date/time (S7) | 200 `AppointmentDetail` | see §6.5 |
| `GET /dealerships/{id}/board?date=` | day timeline per bay & tech | 200 | 404 |
| `GET /dealerships/{id}/inventory` | stock (stand-in for DMS sync) | 200 `{items}` | 404 |
| `PUT /dealerships/{id}/inventory/{sku}` | set `onHand` (simulated DMS sync) | 200 | 404, 409 `STOCK_BELOW_RESERVED` |
| `GET /health/live`, `/health/ready`, `/metrics`, `/docs` | ops | | |

Availability response:
```json
{ "dealershipId": "DLR-01", "serviceTypeCode": "OIL_CHANGE", "date": "2026-10-08",
  "timezone": "Asia/Ho_Chi_Minh", "isWorkingDay": true, "durationMin": 45,
  "sameDay": { "isSameDay": true, "blocked": null, "earliestStartTime": "11:30", "leadTimeMin": 120,
               "quotaCap": 1, "lateGraceMin": 15 },
  "slots": [{ "startTime": "11:30", "endTime": "12:15", "startAt": "2026-10-08T11:30:00+07:00",
              "status": "AVAILABLE", "isExpress": true,
              "proposed": { "serviceBay": {"id":"BAY-01","name":"Bay 1","bayType":"GENERAL_LIFT"},
                            "technician": {"id":"TEC-02","name":"Marco Ortiz"} } }] }
```
`sameDay` is `null` for future dates. When `sameDay.blocked` is non-null, `slots` is `[]`. A non-working day is not an
error for availability: 200 with `isWorkingDay: false` and `slots: []` (and `sameDay: null`).
`isExpress` on a slot = it is a same-day slot (UI label "Express"). `proposed` is a non-binding preview.
Optional `excludeReference=APT-…` (reschedule screen): the grid is computed as if that appointment did not exist — its
bay, technician, same-day quota share and vehicle window are free, and if it already holds same-day parts the parts
check passes. Unknown reference → 404. The appointment must belong to the requested dealership, service and vehicle,
else 422 `RESCHEDULE_SCOPE_MISMATCH`.

### 6.1 `POST /appointments`

Body: `{ customerId, vehicleId, dealershipId, serviceTypeCode, date: "YYYY-MM-DD", startTime: "HH:mm", bookingSessionId: uuid }`.
Header `Idempotency-Key` (optional): repeating a key with the same request (customer, vehicle, dealership, service, date,
start time) returns the original appointment with 200; with a different request → 422 `IDEMPOTENCY_KEY_REUSED`.
`date` must be a real calendar date (`2026-11-31` → 400 `VALIDATION_ERROR`), here and in every query parameter.

Errors: 400 `VALIDATION_ERROR`; 404 `NOT_FOUND`; 409 `SLOT_UNAVAILABLE` (+ `reason: SlotStatus`, `alternatives`);
409 `VEHICLE_ALREADY_BOOKED`; 409 `PARTS_UNAVAILABLE`; 422 `OUTSIDE_BOOKING_HORIZON`, `DEALERSHIP_CLOSED` (not a working day),
`OUTSIDE_OPENING_HOURS`,
`MISALIGNED_START`, `VEHICLE_NOT_OWNED`, `SERVICE_NOT_APPLICABLE`, `SERVICE_NOT_EXPRESS`, `LEAD_TIME_NOT_MET`,
`IDEMPOTENCY_KEY_REUSED`.

Transaction (ADR-002):

1. Validate (zod + domain rules). `channel = SAME_DAY` iff `date == localToday(dealership)`.
   Same-day: non-express → 422 `SERVICE_NOT_EXPRESS`; start < earliestStart → 422 `LEAD_TIME_NOT_MET`.
   Insert `SLOT_REQUESTED` event (own statement, autocommit).
2. `BEGIN`; `SELECT pg_advisory_xact_lock(hashtext(dealership_id || ':' || local_date))`.
3. Load `DayContext` (confirmed appointments only, incl. `sameDayBusy` for same-day) **inside the tx**; `checkWindow`.
4. Vehicle overlap → `VEHICLE_ALREADY_BOOKED`.
5. Not available → `ROLLBACK`; insert `CHECK_FAILED` (with reason) outside tx; compute alternatives
   (requested day + next working days within horizon, skipping windows that overlap the vehicle's own confirmed
   appointments at any dealership); 409.
6. Same-day: reserve parts — `UPDATE inventory SET reserved = reserved + qty WHERE … AND on_hand - reserved >= qty`;
   0 rows → `ROLLBACK`, `CHECK_FAILED`, 409 `PARTS_UNAVAILABLE`. Insert `appointment_parts`.
7. Insert appointment with `proposed` resources + `CHECK_PASSED`, `RESOURCES_RESERVED`, `APPOINTMENT_CREATED`
   events in the same tx; `COMMIT`; 201. Status is immediately `CONFIRMED` (A11).
8. Postgres `23P01` (exclusion violation) anyway → 409 `SLOT_UNAVAILABLE` (defence in depth).

### 6.2 Cancellation

`CONFIRMED` + `start_at > now` + not checked in → `CANCELLED`, release parts (`reserved -= qty`, `released_at = now`),
`APPOINTMENT_CANCELLED` event. Already `CANCELLED` → 200 unchanged. Otherwise (including a check-in or no-show release
that commits while the cancel is running) 409 `APPOINTMENT_NOT_CANCELLABLE`.

### 6.3 Late-arrival policy (same-day only)

- `POST /appointments/{ref}/check-in` (advisor): status must be `CONFIRMED` and not yet checked in, else 409
  `APPOINTMENT_NOT_ACTIVE`. If `channel = SAME_DAY` and `now > start_at + late_grace_min` → mark `NO_SHOW`, release
  parts, `APPOINTMENT_NO_SHOW` event, respond 409 `LATE_ARRIVAL`. Otherwise set `checked_in_at`, `CHECKED_IN` event, 200.
  Advance bookings are never auto-released (advisor discretion).
- **No-show sweeper:** every 60 s (in-process, disabled in tests; exposed as `releaseLateSameDay(now)` for direct
  testing) marks `CONFIRMED` same-day appointments with `checked_in_at IS NULL` and `now > start_at + grace` as
  `NO_SHOW`, releasing resources (constraint `WHERE status='CONFIRMED'` frees them) and parts.

### 6.4 DTOs

`AppointmentDetail` = reference, status, channel, startAt, endAt, localDate, startTime, endTime, durationMin,
createdAt, checkedInAt, cancelledAt, lateGraceMin, customer, vehicle (vinLast4, plate, powertrain), dealership,
serviceType, technician (skills), serviceBay, parts `[{sku,name,qty}]`, `history: [{type, occurredAt, summary, detail}]`.
`summary` is a server-rendered sentence (e.g. "Check passed: Bay 2 and Riya Patel free 13:00–15:00").

### 6.5 Reschedule (S7, ADR-006)

`POST /appointments/{reference}/reschedule`, body `{ date: "YYYY-MM-DD", startTime: "HH:mm", bookingSessionId: uuid }`
→ 200 `AppointmentDetail` (same reference). Dealership, service, customer and vehicle never change; the engine picks the
technician and bay again for the new window.

Errors: 400 `VALIDATION_ERROR`; 404 `NOT_FOUND`; 409 `APPOINTMENT_NOT_RESCHEDULABLE` (not `CONFIRMED`, checked in, or
`start_at <= now`, including a cancel / check-in / no-show that commits while the reschedule runs); 409 `SLOT_UNAVAILABLE`
(+ `reason`, `alternatives`), 409 `VEHICLE_ALREADY_BOOKED`, 409 `PARTS_UNAVAILABLE`; every 422 of §6.1 that applies to
the new date/time (`OUTSIDE_BOOKING_HORIZON`, `DEALERSHIP_CLOSED`, `OUTSIDE_OPENING_HOURS`, `MISALIGNED_START`,
`SERVICE_NOT_EXPRESS`, `LEAD_TIME_NOT_MET`).

Target equals the current `date` + `startTime` → 200, nothing changes, no event (natural idempotency; no
`Idempotency-Key` header for this endpoint).

Order of operations:

1. Load the appointment; check rescheduable (above). Validate the target exactly as §6.1 step 1 (horizon, working day,
   opening hours, 30-minute grid, same-day express and lead time when the target is today). Write `SLOT_REQUESTED`
   (detail as in §6.1 plus `rescheduleOf: reference`).
2. `BEGIN`; advisory locks on `dealership:old_local_date` and `dealership:new_local_date`, **taken in ascending key
   order**, one lock if equal.
3. Inside the tx, re-read the appointment (still `CONFIRMED`, not checked in, start still in the future, else 409
   `APPOINTMENT_NOT_RESCHEDULABLE`) and resolve the target day plan **excluding this appointment** — its bay, technician,
   same-day quota share and vehicle window count as free; if the appointment already holds same-day parts
   (`channel = SAME_DAY` and the target is also today), the parts check is treated as passed.
4. Vehicle overlap with any *other* confirmed appointment → `VEHICLE_ALREADY_BOOKED`.
5. `checkWindow` not available → `ROLLBACK`, `CHECK_FAILED` (with reason and alternatives, alternatives also computed
   excluding this appointment), 409 `SLOT_UNAVAILABLE`.
6. Parts by channel transition (`channel` is recomputed: `SAME_DAY` iff new date == local today):
   ADVANCE → SAME_DAY: reserve as §6.1 step 6 (0 rows → 409 `PARTS_UNAVAILABLE`) and insert `appointment_parts`;
   SAME_DAY → ADVANCE: release as §6.2; SAME_DAY → SAME_DAY: keep the existing reservation; ADVANCE → ADVANCE: nothing.
7. `UPDATE appointments SET start_at, end_at, technician_id, service_bay_id, channel WHERE id = … AND status = 'CONFIRMED'
   AND checked_in_at IS NULL` — 0 rows → 409 `APPOINTMENT_NOT_RESCHEDULABLE`. Insert `APPOINTMENT_RESCHEDULED` with
   `detail { from: {date, startTime, endTime, technicianId, technicianName, bayId, bayName, channel}, to: {…same keys} }`
   in the same tx; `COMMIT`; 200.
8. `23P01` anyway → 409 `SLOT_UNAVAILABLE` / `VEHICLE_ALREADY_BOOKED` (defence in depth).

History summary: `"Rescheduled from Thu 8 Oct 10:00 to Fri 9 Oct 13:00 — Bay 2, Riya Patel"` (same day:
`"Rescheduled from 10:00 to 13:00 — Bay 2, Riya Patel"`).

Metric: `reschedule_attempts_total{outcome,reason}` (outcomes `rescheduled`, `unchanged`, `rejected`, `invalid`),
span `booking.reschedule`.

Required integration tests (name them by id):

| # | Case | Expect |
|---|---|---|
| R1 | Advance brake 10:00 → next day 13:00, free | 200, same reference, new time/tech/bay, `APPOINTMENT_RESCHEDULED` with from/to; old window bookable again |
| R2 | Brake 10:00 → 10:30 same day, only its own resources free | 200 (overlaps only itself) |
| R3 | Move to a non-working day / 16:00 for 120 m / 10:15 / beyond horizon | 422 `DEALERSHIP_CLOSED` / `OUTSIDE_OPENING_HOURS` / `MISALIGNED_START` / `OUTSIDE_BOOKING_HORIZON`; row unchanged |
| R4 | Advance oil change → today (fixed clock 09:10) 11:30 | 200, `channel SAME_DAY`, `inventory.reserved` +qty, `appointment_parts` rows |
| R5 | Same-day oil change → tomorrow | 200, `channel ADVANCE`, parts released (`reserved` −qty, `released_at` set) |
| R6 | Same-day oil change → later today with stock exactly consumed by itself | 200 (own reservation kept, parts check passes) |
| R7 | Target window taken | 409 `SLOT_UNAVAILABLE` + `reason` + alternatives; `CHECK_FAILED`; row unchanged |
| R8 | Target overlaps the same vehicle's other appointment | 409 `VEHICLE_ALREADY_BOOKED` |
| R9 | Cancelled / checked-in / started appointment | 409 `APPOINTMENT_NOT_RESCHEDULABLE` |
| R10 | Target equals current slot | 200, no new event |
| R11 | 20 different appointments rescheduled in parallel into one window with capacity 1 | exactly 1×200, 19×409; one CONFIRMED row in that window |
| R12 | Reschedule ∥ new booking into the same window (capacity 1), repeated 10× | exactly one wins each time |
| R13 | A (day 1 → day 2) ∥ B (day 2 → day 1), repeated 10× | both complete (no deadlock, no `40P01`) |
| R14 | Same-day quota cap 1 already used by this appointment; move it within today | 200 (its own share is excluded) |
| R15 | Reschedule ∥ cancel of the same appointment | either reschedule 200 then cancel 200, or cancel 200 then reschedule 409; never both changed inconsistently |

## 7. Seed data (deterministic, `pnpm db:seed`)

- Dealerships: `DLR-01` Northside Service Center, `DLR-02` Riverside Auto Care, `DLR-03` Airport Road Service;
  all `Asia/Ho_Chi_Minh`, 08:00–17:00, Mon–Fri, lead 120, quota 20%, grace 15.
- Bays per dealership: Bay 1 GENERAL_LIFT, Bay 2 GENERAL_LIFT, Bay 3 ALIGNMENT_RACK, Bay 4 EV_ISOLATED, Bay 5 WASH_BAY.
  DLR-01 → BAY-01..05, DLR-02 → BAY-06..10, DLR-03 → BAY-11..15.
- Technicians DLR-01: TEC-01 An Nguyen [GENERAL,BRAKES,EV_HIGH_VOLTAGE], TEC-02 Marco Ortiz [GENERAL,ALIGNMENT],
  TEC-03 Riya Patel [GENERAL,BRAKES], TEC-04 Jin Kim [GENERAL,EV_HIGH_VOLTAGE].
  DLR-02 TEC-05..08 (same skill mix, invented names). DLR-03 TEC-09..12 **with no ALIGNMENT skill**.
- Service types (name, min, skill, bays in preference order, express, powertrains):

| code | name | min | skill | bays | express | powertrains |
|---|---|---|---|---|---|---|
| OIL_CHANGE | Oil and filter change | 45 | GENERAL | GENERAL_LIFT, ALIGNMENT_RACK | ✔ | ICE |
| GENERAL_INSPECTION | General inspection | 30 | GENERAL | GENERAL_LIFT, ALIGNMENT_RACK | ✔ | ICE, EV |
| AIR_FILTER_REPLACEMENT | Air filter replacement | 30 | GENERAL | GENERAL_LIFT, ALIGNMENT_RACK | ✔ | ICE, EV |
| TIRE_ROTATION | Tire rotation | 45 | GENERAL | GENERAL_LIFT, ALIGNMENT_RACK | ✔ | ICE, EV |
| CAR_WASH | Car wash | 30 | GENERAL | WASH_BAY | ✔ | ICE, EV |
| BRAKE_PAD_REPLACEMENT | Brake pad replacement | 120 | BRAKES | GENERAL_LIFT, ALIGNMENT_RACK | | ICE, EV |
| WHEEL_ALIGNMENT | Wheel alignment | 60 | ALIGNMENT | ALIGNMENT_RACK | | ICE, EV |
| EV_BATTERY_CHECK | High-voltage battery check | 90 | EV_HIGH_VOLTAGE | EV_ISOLATED | | EV |

- Parts: `OIL-5W30-4L` Engine oil 5W-30 4L, `FLT-OIL-CX22` Oil filter Crossover LX, `FLT-OIL-GEN` Oil filter (generic),
  `FLT-AIR-CX22` Air filter Crossover LX, `FLT-CABIN-EV24` Cabin filter Compact EV, `FLT-AIR-GEN` Air filter (generic).
  Requirements: OIL_CHANGE / "Crossover LX" → OIL-5W30-4L×1 + FLT-OIL-CX22×1; OIL_CHANGE / NULL → OIL-5W30-4L×1 +
  FLT-OIL-GEN×1; AIR_FILTER_REPLACEMENT / "Crossover LX" → FLT-AIR-CX22×1; / "Compact EV" → FLT-CABIN-EV24×1;
  / NULL → FLT-AIR-GEN×1. Other services need no parts. Model-specific rows replace the NULL rows for that model.
- Inventory: every dealership stocks every part with `on_hand = 10`, **except DLR-02 `FLT-OIL-CX22 = 0`**
  (demo: same-day oil change for the Crossover at Riverside → `PARTS_UNAVAILABLE`).
- Customer `CUS-10482` Linh Tran (+84 90 123 4567, linh.tran@example.com) with `VEH-01` 2022 Crossover LX ICE
  (VIN `KL1CX22LXNB104821`, 51F-238.47) and `VEH-02` 2024 Compact EV EV (VIN `KLEV24CMPRB200937`, 51H-902.15).
  Background customers `CUS-10001..10012`, one vehicle each (mixed models/powertrains, invented VINs).
- Background load: for each dealership, today and the next 10 working days, ~30% bay utilisation (no technician above
  50% of the day — a flat 50% bay target saturated the Brakes technicians and left the demo's default service unbookable) of `ADVANCE`
  confirmed appointments for background customers, generated **through the domain engine** (always valid), PRNG
  seed `42`, relative to the clock. Re-running the seed truncates and rebuilds.

## 8. Web app (client harness built from the design)

Routes: `/book` (default) · `/appointments` · `/appointments/:reference` · `/appointments/:reference/reschedule` · `/board`.
Design reference: `design/screens/01..03`. Reproduce layout, copy and states; inline styles become CSS modules
using the tokens below.

Tokens: `--bg #EEEFEA`, `--ink #15171A`, `--paper #FFFFFF`, `--line #D5D7D0`, `--line-strong #C9CBC3`,
`--muted #565B61`, `--muted-2 #43474D`, `--accent #1F48C9`, `--accent-soft #E9EEFC`, `--accent-on-dark #9DB4FF`,
`--cta #E8803F`, `--warn-bg #FBEDE4`, `--warn-ink #7A2E09`, `--notech-ink #8F360B`, `--header-ink #F4F4F0`.
Fonts: Archivo (variable `wdth` 62–125, `wght` 100–900; headings use `font-stretch` 110–125%), IBM Plex Mono for
codes/times. Square corners (radius 2px). Focus ring `3px solid --accent`.

Book screen behaviour:
- Defaults VEH-01 / BRAKE_PAD_REPLACEMENT / DLR-01 / first working day after today. Services not applicable to the
  selected vehicle's powertrain are hidden. Express services carry an "Express" tag.
- Date strip: **Today** (if a working day; chip tagged "SAME-DAY") + next 5 working days.
- Changing vehicle/service/dealer/date clears the slot and auto-selects the first `AVAILABLE`. A 409 does **not**
  auto-select: nothing is chosen until the customer picks a slot or an alternative (v0.3.1).
- Copy is plain language (v0.3.1): short sentences, say what happened and what to do next, never show API codes.
- Non-available slots are disabled, hatched, and labelled: Free / No technician / No bay / Booked up / Today is full.
  Same-day available slots show an "Express" label.
- When Today is selected show the notice: *"Same-day booking is for express jobs only. Please arrive on time. If you are
  more than 15 minutes late, we give your time to someone else."* (minutes from `lateGraceMin`).
- `sameDay.blocked` panels: `SERVICE_NOT_EXPRESS` → "{service} can't be booked for today. Today we only take express
  jobs: {list}. Pick another day for this service."; `PARTS_UNAVAILABLE` → "We don't have the parts for this service at
  {dealer} today. Try another dealership or another day." (reschedule: "… today. Try another day."); `PAST_CUTOFF` →
  "Booking for today is closed. Same-day jobs must start at least {lead} hours from now. Pick another day."
- Summary sidebar shows the `proposed` bay/tech; Confirm shows "Reserving your bay and technician…"; 201 → confirmation
  panel; 409 → warning panel listing alternatives as buttons and refetch availability. Fresh `bookingSessionId` per flow.
- "Now" on screen (Today chip, upcoming vs past, Cancel / Reschedule / Check in visibility) is the browser clock, or the
  MSW scenario clock in mock mode. The API's `CLOCK_OVERRIDE` is not visible to the browser; demos that pin it must pin
  the browser clock too (as `e2e/support/test.ts` does). Exposing server time is future work.

Reschedule screen (S7): opened from the record's **Reschedule** button (shown for `CONFIRMED`, not checked in, start in
the future). Vehicle, service and dealership are fixed; a "Current" card shows the existing slot. Same date strip, slot
grid, labels, same-day notice and blocked panels as Book, with availability requested using `excludeReference`; the
current slot is marked "Current" and not selectable, and **no slot is pre-selected** ("Move appointment" stays disabled
until the customer picks one). "Move appointment" → "Reserving your bay and technician…" → 200 **replaces** the history
entry with the record, which shows the notice "Appointment moved to {date} {time}." once; 409 → the Book warning panel
with alternatives.

Board: advisor view; blocks coloured by status/channel (same-day blocks tagged "Express"); a confirmed same-day or
today's block has a **Check in** action; `NO_SHOW` blocks shown struck-through.
