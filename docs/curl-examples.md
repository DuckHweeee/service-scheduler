# cURL walkthrough

The same flow as [`requests.http`](requests.http), as copy-paste shell. The OpenAPI document is in
[`openapi.yaml`](openapi.yaml) (regenerate with `pnpm --filter @scheduler/api openapi:export`); Swagger UI is served at `/docs`.

## Setup

```bash
pnpm db:up                       # embedded PostgreSQL on :54329 (keep running)
pnpm db:migrate && pnpm db:seed
```

### Pin the clock so same-day examples work at any time of day

Same-day booking needs "now" to be early enough in a working day (2 h lead time, dealership open 08:00-17:00 Mon-Fri). Pin
the API's clock with `CLOCK_OVERRIDE` (an ISO instant; business time then stands still at that moment):

```bash
CLOCK_OVERRIDE=2026-10-08T09:00:00+07:00 pnpm --filter @scheduler/api start   # API on :3000
```

With that clock "today" is Thursday 2026-10-08 and the earliest same-day start is 11:00. The seed data is generated
relative to the clock, so seed with the same pinned clock if you pick another date, and keep `FUTURE` a working day a few
working days ahead. Without `CLOCK_OVERRIDE` the system clock is used; then set `TODAY` to the current date in
`Asia/Ho_Chi_Minh` and expect same-day requests to be blocked or rejected outside opening hours.

```bash
BASE=${BASE:-http://localhost:3000}
API=$BASE/api/v1
TODAY=2026-10-08
FUTURE=2026-10-14
JSON='Content-Type: application/json'
KEY=walkthrough-$(date +%s)   # a new key per run; the same key with the same request replays the earlier (possibly cancelled) appointment
# Extract the first "reference" value from a response without needing jq
ref() { grep -o '"reference":"[^"]*"' | head -1 | cut -d'"' -f4; }
```

The flow cancels what it books, except the checked-in appointment in section 6 (a checked-in appointment cannot be cancelled),
so run `pnpm db:seed` again before repeating it.
Add `-i` to any command to see status line and headers (`x-request-id`, `content-type: application/problem+json` on errors).

## 1. Reference data

```bash
curl -s $API/dealerships           # 200 {items}: DLR-01..03 with hours, timezone, bayCount, sameDayPolicy
curl -s $API/service-types         # 200 {items}: 8 services (isExpress, powertrains, durationMin)
curl -s $API/customers/CUS-10482   # 200 Linh Tran
curl -s $API/customers/CUS-10482/vehicles   # 200 {items}: VEH-01 Crossover LX (ICE), VEH-02 Compact EV (EV)
```

## 2. Availability

```bash
# Future day: 200, "sameDay": null, slots[] with status AVAILABLE / NO_BAY / ... and a non-binding "proposed" bay + technician
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=$FUTURE&vehicleId=VEH-01"

# Same day: 200, sameDay.earliestStartTime "11:00", slots are express slots (isExpress: true)
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=$TODAY&vehicleId=VEH-01"

# Blocked same day (not an express service): 200, sameDay.blocked "SERVICE_NOT_EXPRESS", slots []
curl -s "$API/dealerships/DLR-01/availability?serviceType=BRAKE_PAD_REPLACEMENT&date=$TODAY&vehicleId=VEH-01"

# Sunday is not an error: 200, isWorkingDay false, slots []
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=2026-10-11&vehicleId=VEH-01"

# Beyond the booking horizon: 422 problem+json, code OUTSIDE_BOOKING_HORIZON
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=2026-12-30&vehicleId=VEH-01"

# Not a calendar date: 400 VALIDATION_ERROR
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=2026-11-31&vehicleId=VEH-01"
```

## 3. Book, conflict, idempotent replay

```bash
# 201 AppointmentDetail: status CONFIRMED, channel ADVANCE, technician, serviceBay, history[]
REF=$(curl -s -X POST $API/appointments -H "$JSON" -H "Idempotency-Key: $KEY" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$FUTURE'","startTime":"08:00","bookingSessionId":"11111111-1111-4111-8111-111111111111"}' | ref)
echo $REF    # e.g. APT-20261014-0486

# Idempotent replay (same key): 200 with the original appointment, same reference, nothing new created
curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/appointments -H "$JSON" -H "Idempotency-Key: $KEY" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$FUTURE'","startTime":"08:00","bookingSessionId":"11111111-1111-4111-8111-111111111111"}'

# Same key, different request (another start time): 422 IDEMPOTENCY_KEY_REUSED, nothing created
curl -s -X POST $API/appointments -H "$JSON" -H "Idempotency-Key: $KEY" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$FUTURE'","startTime":"09:00","bookingSessionId":"11111111-1111-4111-8111-111111111111"}'

# Conflict: another customer, same slot => 409 SLOT_UNAVAILABLE with "reason" (e.g. NO_BAY) and up to 5 "alternatives"
curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10001","vehicleId":"VEH-03","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$FUTURE'","startTime":"08:00","bookingSessionId":"22222222-2222-4222-8222-222222222222"}'

# Same vehicle, overlapping time: 409 VEHICLE_ALREADY_BOOKED
curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$FUTURE'","startTime":"08:00","bookingSessionId":"11111111-1111-4111-8111-111111111111"}'
```

## 4. Detail and list

```bash
curl -s $API/appointments/$REF                                      # 200 with history: SLOT_REQUESTED, CHECK_PASSED, RESOURCES_RESERVED, APPOINTMENT_CREATED, ...
curl -s "$API/appointments?customerId=CUS-10482&status=CONFIRMED"   # 200 {items}, upcoming first
curl -s $API/appointments/APT-00000000-0000                         # 404 NOT_FOUND
```

## 4b. Reschedule

```bash
# Availability as if the appointment did not exist (its own window shows AVAILABLE): 200
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=$FUTURE&vehicleId=VEH-01&excludeReference=$REF"

# Move it in place to 09:00: 200, same reference, history ends with "Rescheduled from 08:00 to 09:00 — Bay n, <technician>"
curl -s -X POST $API/appointments/$REF/reschedule -H "$JSON" -d '{
  "date":"'$FUTURE'","startTime":"09:00","bookingSessionId":"66666666-6666-4666-8666-666666666666"}'
# Same target again: 200, nothing changes. Refusals: 409 SLOT_UNAVAILABLE | VEHICLE_ALREADY_BOOKED | PARTS_UNAVAILABLE | APPOINTMENT_NOT_RESCHEDULABLE
```

## 5. Cancel

```bash
curl -s -X POST $API/appointments/$REF/cancel -H "$JSON" -d '{"reason":"Customer rescheduled"}'   # 200 status CANCELLED, slot is free again
curl -s -X POST $API/appointments/$REF/cancel          # 200 unchanged (idempotent)
curl -s -X POST $API/appointments/$REF/check-in        # 409 APPOINTMENT_NOT_ACTIVE
```

## 6. Check-in

```bash
EV=$(curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-02","dealershipId":"DLR-01","serviceTypeCode":"GENERAL_INSPECTION",
  "date":"'$FUTURE'","startTime":"08:00","bookingSessionId":"33333333-3333-4333-8333-333333333333"}' | ref)

curl -s -X POST $API/appointments/$EV/check-in   # 200, checkedInAt set
curl -s -X POST $API/appointments/$EV/check-in   # 409 APPOINTMENT_NOT_ACTIVE ("already checked in")
curl -s -X POST $API/appointments/$EV/cancel     # 409 APPOINTMENT_NOT_CANCELLABLE: already checked in
```

A same-day appointment checked in later than `start + lateGraceMin` is marked `NO_SHOW` and the call returns
409 `LATE_ARRIVAL`; with the clock pinned this cannot happen in the walkthrough (time does not move).

## 7. Inventory and same-day parts

```bash
curl -s $API/dealerships/DLR-01/inventory     # 200 {items}: sku, onHand, reserved, available

# Simulated DMS sync: no Crossover oil filters => 200
curl -s -X PUT $API/dealerships/DLR-01/inventory/FLT-OIL-CX22 -H "$JSON" -d '{"onHand":0}'

# Same-day availability: sameDay.blocked "PARTS_UNAVAILABLE", slots []
curl -s "$API/dealerships/DLR-01/availability?serviceType=OIL_CHANGE&date=$TODAY&vehicleId=VEH-01"

# Same-day booking: 409 PARTS_UNAVAILABLE
curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$TODAY'","startTime":"11:00","bookingSessionId":"44444444-4444-4444-8444-444444444444"}'

# Restock => 200, then the same booking succeeds: 201, channel SAME_DAY, parts reserved
curl -s -X PUT $API/dealerships/DLR-01/inventory/FLT-OIL-CX22 -H "$JSON" -d '{"onHand":10}'
SD=$(curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10482","vehicleId":"VEH-01","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$TODAY'","startTime":"11:00","bookingSessionId":"44444444-4444-4444-8444-444444444444"}' | ref)

# Earlier than the 2 h lead time: 422 LEAD_TIME_NOT_MET
curl -s -X POST $API/appointments -H "$JSON" -d '{
  "customerId":"CUS-10001","vehicleId":"VEH-03","dealershipId":"DLR-01","serviceTypeCode":"OIL_CHANGE",
  "date":"'$TODAY'","startTime":"09:30","bookingSessionId":"55555555-5555-4555-8555-555555555555"}'
```

## 8. Board

```bash
curl -s "$API/dealerships/DLR-01/board?date=$TODAY"    # 200: day timeline per bay and technician, includes the same-day booking
curl -s -X POST $API/appointments/$SD/cancel           # release bay, technician and reserved parts: 200 CANCELLED
```

## 9. Health and metrics

```bash
curl -s $BASE/health/live      # {"status":"ok"}
curl -s $BASE/health/ready     # {"status":"ok"} (503 when the database is unreachable)
curl -s $BASE/metrics | grep -E '^(booking_attempts_total|http_request_duration_seconds_count)'
```

Expected after the flow above: `booking_attempts_total{outcome="created",...}`, `{outcome="replayed",...}` and
`{outcome="rejected",reason="NO_BAY"|"PARTS_UNAVAILABLE"|...}` counters, and per-route
`http_request_duration_seconds_count{route="/api/v1/appointments",status_code="409"}`. See
[`observability.md`](observability.md) for what each metric answers.
