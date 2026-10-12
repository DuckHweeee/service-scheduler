-- Booking invariants after a load run. One row per violation; a healthy database returns 0 rows.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f loadtest/verify-invariants.sql
-- (the same checks are enforced by exclusion/check constraints; this proves it from the data, independently.)
WITH confirmed AS (
  SELECT id, reference, technician_id, service_bay_id, vehicle_id, channel, during
  FROM appointments
  WHERE status = 'CONFIRMED'
)
SELECT 'TECHNICIAN_OVERLAP' AS violation, a.technician_id AS subject, a.reference AS a, b.reference AS b
FROM confirmed a JOIN confirmed b ON a.technician_id = b.technician_id AND a.id < b.id AND a.during && b.during
UNION ALL
SELECT 'BAY_OVERLAP', a.service_bay_id, a.reference, b.reference
FROM confirmed a JOIN confirmed b ON a.service_bay_id = b.service_bay_id AND a.id < b.id AND a.during && b.during
UNION ALL
SELECT 'VEHICLE_OVERLAP', a.vehicle_id, a.reference, b.reference
FROM confirmed a JOIN confirmed b ON a.vehicle_id = b.vehicle_id AND a.id < b.id AND a.during && b.during
UNION ALL
SELECT 'RESERVED_GT_ON_HAND', i.dealership_id || '/' || i.sku, 'reserved=' || i.reserved, 'on_hand=' || i.on_hand
FROM inventory i WHERE i.reserved > i.on_hand
UNION ALL
-- same-day CONFIRMED appointments whose parts are required but not reserved (no live appointment_parts row)
SELECT 'SAME_DAY_PARTS_NOT_RESERVED', c.reference, r.sku, NULL
FROM confirmed c
JOIN appointments ap ON ap.id = c.id
JOIN vehicles v ON v.id = ap.vehicle_id
JOIN service_part_requirements r
  ON r.service_type_code = ap.service_type_code AND (r.vehicle_model IS NULL OR r.vehicle_model = v.model_name)
WHERE c.channel = 'SAME_DAY'
  AND NOT EXISTS (
    SELECT 1 FROM appointment_parts p
    WHERE p.appointment_id = c.id AND p.sku = r.sku AND p.released_at IS NULL
  )
  -- a model-specific requirement overrides the generic (NULL model) one
  AND NOT (r.vehicle_model IS NULL AND EXISTS (
    SELECT 1 FROM service_part_requirements r2
    WHERE r2.service_type_code = r.service_type_code AND r2.vehicle_model = v.model_name
  ));
