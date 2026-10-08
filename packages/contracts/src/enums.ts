import { z } from 'zod';

// SPEC §3. Values are the wire format and must match the Postgres enums in SPEC §4.

export const Skill = z.enum(['GENERAL', 'BRAKES', 'ALIGNMENT', 'EV_HIGH_VOLTAGE']);
export type Skill = z.infer<typeof Skill>;

export const BayType = z.enum(['GENERAL_LIFT', 'ALIGNMENT_RACK', 'EV_ISOLATED', 'WASH_BAY']);
export type BayType = z.infer<typeof BayType>;

export const Powertrain = z.enum(['ICE', 'EV']);
export type Powertrain = z.infer<typeof Powertrain>;

export const AppointmentStatus = z.enum(['CONFIRMED', 'CANCELLED', 'NO_SHOW']);
export type AppointmentStatus = z.infer<typeof AppointmentStatus>;

export const BookingChannel = z.enum(['ADVANCE', 'SAME_DAY']);
export type BookingChannel = z.infer<typeof BookingChannel>;

export const SlotStatus = z.enum([
  'AVAILABLE',
  'NO_QUALIFIED_TECHNICIAN',
  'NO_BAY',
  'FULLY_BOOKED',
  'SAME_DAY_QUOTA_REACHED',
]);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const SameDayBlock = z.enum(['SERVICE_NOT_EXPRESS', 'PARTS_UNAVAILABLE', 'PAST_CUTOFF']);
export type SameDayBlock = z.infer<typeof SameDayBlock>;

export const BookingEventType = z.enum([
  'SLOT_REQUESTED',
  'CHECK_FAILED',
  'CHECK_PASSED',
  'RESOURCES_RESERVED',
  'APPOINTMENT_CREATED',
  'APPOINTMENT_CANCELLED',
  'CHECKED_IN',
  'APPOINTMENT_NO_SHOW',
]);
export type BookingEventType = z.infer<typeof BookingEventType>;

// Every `code` the API may put in a problem+json body (SPEC §6).
export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'INTERNAL_ERROR',
  'SLOT_UNAVAILABLE',
  'VEHICLE_ALREADY_BOOKED',
  'PARTS_UNAVAILABLE',
  'OUTSIDE_BOOKING_HORIZON',
  'OUTSIDE_OPENING_HOURS',
  'MISALIGNED_START',
  'VEHICLE_NOT_OWNED',
  'SERVICE_NOT_APPLICABLE',
  'SERVICE_NOT_EXPRESS',
  'LEAD_TIME_NOT_MET',
  'APPOINTMENT_NOT_CANCELLABLE',
  'APPOINTMENT_NOT_ACTIVE',
  'LATE_ARRIVAL',
  'STOCK_BELOW_RESERVED',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;
