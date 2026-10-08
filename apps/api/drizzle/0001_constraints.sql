-- Hand-written (SPEC §4): things drizzle cannot express. The EXCLUDE constraints are the final guarantee
-- against double booking (ADR-002).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE SEQUENCE IF NOT EXISTS appointment_ref_seq;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "during" tstzrange GENERATED ALWAYS AS (tstzrange("start_at", "end_at", '[)')) STORED;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "no_technician_overlap" EXCLUDE USING gist ("technician_id" WITH =, "during" WITH &&) WHERE ("status" = 'CONFIRMED');--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "no_bay_overlap" EXCLUDE USING gist ("service_bay_id" WITH =, "during" WITH &&) WHERE ("status" = 'CONFIRMED');--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "no_vehicle_overlap" EXCLUDE USING gist ("vehicle_id" WITH =, "during" WITH &&) WHERE ("status" = 'CONFIRMED');
