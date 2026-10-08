CREATE TYPE "public"."appointment_status" AS ENUM('CONFIRMED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."bay_type" AS ENUM('GENERAL_LIFT', 'ALIGNMENT_RACK', 'EV_ISOLATED', 'WASH_BAY');--> statement-breakpoint
CREATE TYPE "public"."booking_channel" AS ENUM('ADVANCE', 'SAME_DAY');--> statement-breakpoint
CREATE TYPE "public"."powertrain" AS ENUM('ICE', 'EV');--> statement-breakpoint
CREATE TYPE "public"."skill" AS ENUM('GENERAL', 'BRAKES', 'ALIGNMENT', 'EV_HIGH_VOLTAGE');--> statement-breakpoint
CREATE TABLE "appointment_parts" (
	"appointment_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "appointment_parts_appointment_id_sku_pk" PRIMARY KEY("appointment_id","sku"),
	CONSTRAINT "appointment_parts_qty_check" CHECK ("appointment_parts"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"status" "appointment_status" DEFAULT 'CONFIRMED' NOT NULL,
	"channel" "booking_channel" NOT NULL,
	"customer_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"dealership_id" text NOT NULL,
	"service_type_code" text NOT NULL,
	"technician_id" text NOT NULL,
	"service_bay_id" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"duration_min" integer NOT NULL,
	"booking_session_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	CONSTRAINT "appointments_reference_unique" UNIQUE("reference"),
	CONSTRAINT "appointments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "appointments_end_after_start" CHECK ("appointments"."end_at" > "appointments"."start_at")
);
--> statement-breakpoint
CREATE TABLE "booking_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid,
	"appointment_id" uuid,
	"type" text NOT NULL,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"email" text
);
--> statement-breakpoint
CREATE TABLE "dealerships" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"opens_at" time NOT NULL,
	"closes_at" time NOT NULL,
	"working_days" smallint[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"same_day_lead_min" integer DEFAULT 120 NOT NULL,
	"same_day_quota_pct" integer DEFAULT 20 NOT NULL,
	"late_grace_min" integer DEFAULT 15 NOT NULL,
	CONSTRAINT "dealerships_same_day_quota_pct_check" CHECK ("dealerships"."same_day_quota_pct" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"dealership_id" text NOT NULL,
	"sku" text NOT NULL,
	"on_hand" integer NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_dealership_id_sku_pk" PRIMARY KEY("dealership_id","sku"),
	CONSTRAINT "inventory_on_hand_check" CHECK ("inventory"."on_hand" >= 0),
	CONSTRAINT "inventory_reserved_check" CHECK ("inventory"."reserved" >= 0),
	CONSTRAINT "inventory_reserved_le_on_hand" CHECK ("inventory"."reserved" <= "inventory"."on_hand")
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"sku" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_bays" (
	"id" text PRIMARY KEY NOT NULL,
	"dealership_id" text NOT NULL,
	"name" text NOT NULL,
	"bay_type" "bay_type" NOT NULL,
	CONSTRAINT "service_bays_id_dealership_id_key" UNIQUE("id","dealership_id")
);
--> statement-breakpoint
CREATE TABLE "service_part_requirements" (
	"service_type_code" text NOT NULL,
	"vehicle_model" text,
	"sku" text NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "service_part_requirements_qty_check" CHECK ("service_part_requirements"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "service_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"duration_min" integer NOT NULL,
	"required_skill" "skill" NOT NULL,
	"allowed_bay_types" "bay_type"[] NOT NULL,
	"is_express" boolean DEFAULT false NOT NULL,
	"powertrains" "powertrain"[] DEFAULT '{ICE,EV}' NOT NULL,
	CONSTRAINT "service_types_duration_min_check" CHECK ("service_types"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "technicians" (
	"id" text PRIMARY KEY NOT NULL,
	"dealership_id" text NOT NULL,
	"name" text NOT NULL,
	"skills" "skill"[] NOT NULL,
	CONSTRAINT "technicians_id_dealership_id_key" UNIQUE("id","dealership_id")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"model_year" integer NOT NULL,
	"model_name" text NOT NULL,
	"powertrain" "powertrain" NOT NULL,
	"vin" char(17) NOT NULL,
	"plate" text,
	CONSTRAINT "vehicles_vin_unique" UNIQUE("vin")
);
--> statement-breakpoint
ALTER TABLE "appointment_parts" ADD CONSTRAINT "appointment_parts_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_parts" ADD CONSTRAINT "appointment_parts_sku_parts_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."parts"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_type_code_service_types_code_fk" FOREIGN KEY ("service_type_code") REFERENCES "public"."service_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_technician_dealership_fk" FOREIGN KEY ("technician_id","dealership_id") REFERENCES "public"."technicians"("id","dealership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_bay_dealership_fk" FOREIGN KEY ("service_bay_id","dealership_id") REFERENCES "public"."service_bays"("id","dealership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_sku_parts_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."parts"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_bays" ADD CONSTRAINT "service_bays_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_requirements" ADD CONSTRAINT "service_part_requirements_service_type_code_service_types_code_fk" FOREIGN KEY ("service_type_code") REFERENCES "public"."service_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_part_requirements" ADD CONSTRAINT "service_part_requirements_sku_parts_sku_fk" FOREIGN KEY ("sku") REFERENCES "public"."parts"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_dealership_id_dealerships_id_fk" FOREIGN KEY ("dealership_id") REFERENCES "public"."dealerships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_dealership_start" ON "appointments" USING btree ("dealership_id","start_at");--> statement-breakpoint
CREATE INDEX "appointments_customer_start" ON "appointments" USING btree ("customer_id","start_at");--> statement-breakpoint
CREATE INDEX "booking_events_session" ON "booking_events" USING btree ("session_id","occurred_at");--> statement-breakpoint
CREATE INDEX "booking_events_appointment" ON "booking_events" USING btree ("appointment_id","occurred_at");