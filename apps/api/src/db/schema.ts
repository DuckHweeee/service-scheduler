// Drizzle table definitions for SPEC §4. The exclusion constraints, the generated `during` column, btree_gist and
// the reference sequence are NOT expressible here; they live in the hand-written migration `drizzle/0001_*.sql`.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const skillEnum = pgEnum('skill', ['GENERAL', 'BRAKES', 'ALIGNMENT', 'EV_HIGH_VOLTAGE']);
export const bayTypeEnum = pgEnum('bay_type', ['GENERAL_LIFT', 'ALIGNMENT_RACK', 'EV_ISOLATED', 'WASH_BAY']);
export const powertrainEnum = pgEnum('powertrain', ['ICE', 'EV']);
export const appointmentStatusEnum = pgEnum('appointment_status', ['CONFIRMED', 'CANCELLED', 'NO_SHOW']);
export const bookingChannelEnum = pgEnum('booking_channel', ['ADVANCE', 'SAME_DAY']);

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const dealerships = pgTable(
  'dealerships',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull(),
    opensAt: time('opens_at').notNull(),
    closesAt: time('closes_at').notNull(),
    workingDays: smallint('working_days').array().notNull().default(sql`'{1,2,3,4,5}'`),
    sameDayLeadMin: integer('same_day_lead_min').notNull().default(120),
    sameDayQuotaPct: integer('same_day_quota_pct').notNull().default(20),
    lateGraceMin: integer('late_grace_min').notNull().default(15),
  },
  (t) => [check('dealerships_same_day_quota_pct_check', sql`${t.sameDayQuotaPct} BETWEEN 0 AND 100`)],
);

export const serviceBays = pgTable(
  'service_bays',
  {
    id: text('id').primaryKey(),
    dealershipId: text('dealership_id')
      .notNull()
      .references(() => dealerships.id),
    name: text('name').notNull(),
    bayType: bayTypeEnum('bay_type').notNull(),
  },
  (t) => [unique('service_bays_id_dealership_id_key').on(t.id, t.dealershipId)],
);

export const technicians = pgTable(
  'technicians',
  {
    id: text('id').primaryKey(),
    dealershipId: text('dealership_id')
      .notNull()
      .references(() => dealerships.id),
    name: text('name').notNull(),
    skills: skillEnum('skills').array().notNull(),
  },
  (t) => [unique('technicians_id_dealership_id_key').on(t.id, t.dealershipId)],
);

export const serviceTypes = pgTable(
  'service_types',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull(),
    requiredSkill: skillEnum('required_skill').notNull(),
    allowedBayTypes: bayTypeEnum('allowed_bay_types').array().notNull(),
    isExpress: boolean('is_express').notNull().default(false),
    powertrains: powertrainEnum('powertrains').array().notNull().default(sql`'{ICE,EV}'`),
  },
  (t) => [check('service_types_duration_min_check', sql`${t.durationMin} > 0`)],
);

export const customers = pgTable('customers', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: text('email'),
});

export const vehicles = pgTable('vehicles', {
  id: text('id').primaryKey(),
  customerId: text('customer_id')
    .notNull()
    .references(() => customers.id),
  modelYear: integer('model_year').notNull(),
  modelName: text('model_name').notNull(),
  powertrain: powertrainEnum('powertrain').notNull(),
  vin: char('vin', { length: 17 }).notNull().unique(),
  plate: text('plate'),
});

export const parts = pgTable('parts', {
  sku: text('sku').primaryKey(),
  name: text('name').notNull(),
});

export const servicePartRequirements = pgTable(
  'service_part_requirements',
  {
    serviceTypeCode: text('service_type_code')
      .notNull()
      .references(() => serviceTypes.code),
    vehicleModel: text('vehicle_model'),
    sku: text('sku')
      .notNull()
      .references(() => parts.sku),
    qty: integer('qty').notNull(),
  },
  (t) => [check('service_part_requirements_qty_check', sql`${t.qty} > 0`)],
);

export const inventory = pgTable(
  'inventory',
  {
    dealershipId: text('dealership_id')
      .notNull()
      .references(() => dealerships.id),
    sku: text('sku')
      .notNull()
      .references(() => parts.sku),
    onHand: integer('on_hand').notNull(),
    reserved: integer('reserved').notNull().default(0),
    updatedAt: tstz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.dealershipId, t.sku] }),
    check('inventory_on_hand_check', sql`${t.onHand} >= 0`),
    check('inventory_reserved_check', sql`${t.reserved} >= 0`),
    check('inventory_reserved_le_on_hand', sql`${t.reserved} <= ${t.onHand}`),
  ],
);

// `during tstzrange GENERATED ALWAYS AS (...) STORED` and the EXCLUDE constraints are added in the hand-written
// migration; the column is intentionally absent here so inserts never try to write it.
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    reference: text('reference').notNull().unique(),
    status: appointmentStatusEnum('status').notNull().default('CONFIRMED'),
    channel: bookingChannelEnum('channel').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    dealershipId: text('dealership_id')
      .notNull()
      .references(() => dealerships.id),
    serviceTypeCode: text('service_type_code')
      .notNull()
      .references(() => serviceTypes.code),
    technicianId: text('technician_id').notNull(),
    serviceBayId: text('service_bay_id').notNull(),
    startAt: tstz('start_at').notNull(),
    endAt: tstz('end_at').notNull(),
    durationMin: integer('duration_min').notNull(),
    bookingSessionId: uuid('booking_session_id'),
    idempotencyKey: text('idempotency_key').unique(),
    createdAt: tstz('created_at').notNull().defaultNow(),
    checkedInAt: tstz('checked_in_at'),
    cancelledAt: tstz('cancelled_at'),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    check('appointments_end_after_start', sql`${t.endAt} > ${t.startAt}`),
    foreignKey({
      columns: [t.technicianId, t.dealershipId],
      foreignColumns: [technicians.id, technicians.dealershipId],
      name: 'appointments_technician_dealership_fk',
    }),
    foreignKey({
      columns: [t.serviceBayId, t.dealershipId],
      foreignColumns: [serviceBays.id, serviceBays.dealershipId],
      name: 'appointments_bay_dealership_fk',
    }),
    index('appointments_dealership_start').on(t.dealershipId, t.startAt),
    index('appointments_customer_start').on(t.customerId, t.startAt),
  ],
);

export const appointmentParts = pgTable(
  'appointment_parts',
  {
    appointmentId: uuid('appointment_id')
      .notNull()
      .references(() => appointments.id),
    sku: text('sku')
      .notNull()
      .references(() => parts.sku),
    qty: integer('qty').notNull(),
    releasedAt: tstz('released_at'),
  },
  (t) => [
    primaryKey({ columns: [t.appointmentId, t.sku] }),
    check('appointment_parts_qty_check', sql`${t.qty} > 0`),
  ],
);

export const bookingEvents = pgTable(
  'booking_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    sessionId: uuid('session_id'),
    appointmentId: uuid('appointment_id').references(() => appointments.id),
    type: text('type').notNull(),
    detail: jsonb('detail').notNull().default(sql`'{}'`),
    occurredAt: tstz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('booking_events_session').on(t.sessionId, t.occurredAt),
    index('booking_events_appointment').on(t.appointmentId, t.occurredAt),
  ],
);
