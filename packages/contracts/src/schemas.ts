import { z } from 'zod';
import {
  AppointmentStatus,
  BayType,
  BookingChannel,
  BookingEventType,
  ErrorCode,
  Powertrain,
  SameDayBlock,
  Skill,
  SlotStatus,
} from './enums.js';

// ---------- primitives ----------

/** Dealership-local calendar date, `YYYY-MM-DD`. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    // Reject dates the regex lets through but the calendar does not have (2027-02-30, 2026-04-31).
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d;
  }, 'Not a calendar date');
/** Dealership-local wall-clock time, `HH:mm` (24h). */
export const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
/** ISO 8601 instant with the dealership's UTC offset, e.g. `2026-10-08T13:00:00+07:00`. */
export const OffsetDateTime = z.iso.datetime({ offset: true });
export const Id = z.string().min(1).max(64);
export const AppointmentReference = z.string().regex(/^APT-\d{8}-\d{4}$/, 'Expected APT-YYYYMMDD-NNNN');

export const listOf = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

// ---------- reference data ----------

export const SameDayPolicy = z.object({
  leadTimeMin: z.number().int().nonnegative(),
  quotaPct: z.number().int().min(0).max(100),
  lateGraceMin: z.number().int().nonnegative(),
});
export type SameDayPolicy = z.infer<typeof SameDayPolicy>;

export const Dealership = z.object({
  id: Id,
  name: z.string(),
  timezone: z.string(),
  opensAt: LocalTime,
  closesAt: LocalTime,
  /** ISO weekdays, 1 = Monday … 7 = Sunday. */
  workingDays: z.array(z.number().int().min(1).max(7)),
  bayCount: z.number().int().nonnegative(),
  sameDayPolicy: SameDayPolicy,
});
export type Dealership = z.infer<typeof Dealership>;
export const DealershipList = listOf(Dealership);
export type DealershipList = z.infer<typeof DealershipList>;

export const ServiceType = z.object({
  code: Id,
  name: z.string(),
  durationMin: z.number().int().positive(),
  requiredSkill: Skill,
  allowedBayTypes: z.array(BayType).min(1),
  isExpress: z.boolean(),
  powertrains: z.array(Powertrain).min(1),
});
export type ServiceType = z.infer<typeof ServiceType>;
export const ServiceTypeList = listOf(ServiceType);
export type ServiceTypeList = z.infer<typeof ServiceTypeList>;

export const Customer = z.object({
  id: Id,
  fullName: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type Customer = z.infer<typeof Customer>;

export const Vehicle = z.object({
  id: Id,
  customerId: Id,
  modelYear: z.number().int(),
  modelName: z.string(),
  powertrain: Powertrain,
  vinLast4: z.string().length(4),
  plate: z.string().nullable(),
});
export type Vehicle = z.infer<typeof Vehicle>;
export const VehicleList = listOf(Vehicle);
export type VehicleList = z.infer<typeof VehicleList>;

export const ServiceBayRef = z.object({ id: Id, name: z.string(), bayType: BayType });
export type ServiceBayRef = z.infer<typeof ServiceBayRef>;
export const TechnicianRef = z.object({ id: Id, name: z.string() });
export type TechnicianRef = z.infer<typeof TechnicianRef>;
export const TechnicianDetail = TechnicianRef.extend({ skills: z.array(Skill) });
export type TechnicianDetail = z.infer<typeof TechnicianDetail>;

// ---------- availability ----------

export const AvailabilityQuery = z.object({
  serviceType: Id,
  date: LocalDate,
  vehicleId: Id,
  /** Reschedule screen (SPEC §6.5): compute the grid as if this appointment did not exist. */
  excludeReference: AppointmentReference.optional(),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuery>;

export const ProposedAssignment = z.object({ serviceBay: ServiceBayRef, technician: TechnicianRef });
export type ProposedAssignment = z.infer<typeof ProposedAssignment>;

export const AvailabilitySlot = z.object({
  startTime: LocalTime,
  endTime: LocalTime,
  startAt: OffsetDateTime,
  status: SlotStatus,
  /** True for slots on the same-day (express) channel. */
  isExpress: z.boolean(),
  /** Non-binding preview; non-null iff status is AVAILABLE. */
  proposed: ProposedAssignment.nullable(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlot>;

export const SameDayInfo = z.object({
  isSameDay: z.literal(true),
  blocked: SameDayBlock.nullable(),
  /** Earliest bookable start after lead time; null when blocked before it could be computed. */
  earliestStartTime: LocalTime.nullable(),
  leadTimeMin: z.number().int().nonnegative(),
  quotaCap: z.number().int().nonnegative(),
  lateGraceMin: z.number().int().nonnegative(),
});
export type SameDayInfo = z.infer<typeof SameDayInfo>;

export const AvailabilityResponse = z.object({
  dealershipId: Id,
  serviceTypeCode: Id,
  date: LocalDate,
  timezone: z.string(),
  isWorkingDay: z.boolean(),
  durationMin: z.number().int().positive(),
  /** null for dates after today. */
  sameDay: SameDayInfo.nullable(),
  /** Empty when not a working day or when sameDay.blocked is set. */
  slots: z.array(AvailabilitySlot),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;

// ---------- appointments ----------

export const CreateAppointmentRequest = z.object({
  customerId: Id,
  vehicleId: Id,
  dealershipId: Id,
  serviceTypeCode: Id,
  date: LocalDate,
  startTime: LocalTime,
  bookingSessionId: z.uuid(),
});
export type CreateAppointmentRequest = z.infer<typeof CreateAppointmentRequest>;

export const AlternativeSlot = z.object({
  date: LocalDate,
  startTime: LocalTime,
  endTime: LocalTime,
  startAt: OffsetDateTime,
});
export type AlternativeSlot = z.infer<typeof AlternativeSlot>;

export const HistoryEntry = z.object({
  type: BookingEventType,
  occurredAt: OffsetDateTime,
  /** Server-rendered sentence, e.g. "Check passed: Bay 2 and Riya Patel free 13:00–15:00". */
  summary: z.string(),
  detail: z.record(z.string(), z.unknown()),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;

export const AppointmentPartLine = z.object({ sku: Id, name: z.string(), qty: z.number().int().positive() });
export type AppointmentPartLine = z.infer<typeof AppointmentPartLine>;

const appointmentTiming = {
  reference: AppointmentReference,
  status: AppointmentStatus,
  channel: BookingChannel,
  startAt: OffsetDateTime,
  endAt: OffsetDateTime,
  localDate: LocalDate,
  startTime: LocalTime,
  endTime: LocalTime,
  durationMin: z.number().int().positive(),
};

export const AppointmentDetail = z.object({
  ...appointmentTiming,
  createdAt: OffsetDateTime,
  checkedInAt: OffsetDateTime.nullable(),
  cancelledAt: OffsetDateTime.nullable(),
  lateGraceMin: z.number().int().nonnegative(),
  customer: Customer,
  vehicle: Vehicle,
  dealership: z.object({ id: Id, name: z.string(), timezone: z.string() }),
  serviceType: z.object({ code: Id, name: z.string(), requiredSkill: Skill, isExpress: z.boolean() }),
  technician: TechnicianDetail,
  serviceBay: ServiceBayRef,
  parts: z.array(AppointmentPartLine),
  history: z.array(HistoryEntry),
});
export type AppointmentDetail = z.infer<typeof AppointmentDetail>;

export const AppointmentSummary = z.object({
  ...appointmentTiming,
  dealership: z.object({ id: Id, name: z.string() }),
  serviceType: z.object({ code: Id, name: z.string() }),
  vehicle: z.object({ id: Id, modelYear: z.number().int(), modelName: z.string(), plate: z.string().nullable() }),
});
export type AppointmentSummary = z.infer<typeof AppointmentSummary>;
export const AppointmentList = listOf(AppointmentSummary);
export type AppointmentList = z.infer<typeof AppointmentList>;

export const ListAppointmentsQuery = z.object({
  customerId: Id,
  status: AppointmentStatus.optional(),
});
export type ListAppointmentsQuery = z.infer<typeof ListAppointmentsQuery>;

export const CancelAppointmentRequest = z.object({ reason: z.string().max(500).optional() });
export type CancelAppointmentRequest = z.infer<typeof CancelAppointmentRequest>;

/** SPEC §6.5: new local date + start; dealership, service, customer and vehicle never change. */
export const RescheduleAppointmentRequest = z.object({
  date: LocalDate,
  startTime: LocalTime,
  bookingSessionId: z.uuid(),
});
export type RescheduleAppointmentRequest = z.infer<typeof RescheduleAppointmentRequest>;

export const ReferenceParams = z.object({ reference: AppointmentReference });
export const IdParams = z.object({ id: Id });
export const InventoryItemParams = z.object({ id: Id, sku: Id });

// ---------- service board ----------

export const BoardQuery = z.object({ date: LocalDate });
export type BoardQuery = z.infer<typeof BoardQuery>;

export const BoardBlock = z.object({
  reference: AppointmentReference,
  status: AppointmentStatus.exclude(['CANCELLED']),
  channel: BookingChannel,
  serviceTypeCode: Id,
  serviceTypeName: z.string(),
  startTime: LocalTime,
  endTime: LocalTime,
  startAt: OffsetDateTime,
  endAt: OffsetDateTime,
  checkedInAt: OffsetDateTime.nullable(),
});
export type BoardBlock = z.infer<typeof BoardBlock>;

export const BoardResponse = z.object({
  dealership: z.object({ id: Id, name: z.string(), timezone: z.string() }),
  date: LocalDate,
  isWorkingDay: z.boolean(),
  opensAt: LocalTime,
  closesAt: LocalTime,
  /** Every bay, including idle ones, with CONFIRMED and NO_SHOW blocks sorted by start. */
  bays: z.array(ServiceBayRef.extend({ blocks: z.array(BoardBlock) })),
  technicians: z.array(TechnicianDetail.extend({ blocks: z.array(BoardBlock) })),
});
export type BoardResponse = z.infer<typeof BoardResponse>;

// ---------- inventory (stand-in for DMS sync) ----------

export const InventoryItem = z.object({
  sku: Id,
  name: z.string(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  updatedAt: OffsetDateTime,
});
export type InventoryItem = z.infer<typeof InventoryItem>;
export const InventoryList = listOf(InventoryItem);
export type InventoryList = z.infer<typeof InventoryList>;

export const UpdateInventoryRequest = z.object({ onHand: z.number().int().nonnegative() });
export type UpdateInventoryRequest = z.infer<typeof UpdateInventoryRequest>;

// ---------- errors (RFC 7807) ----------

export const Problem = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: ErrorCode,
  detail: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** SLOT_UNAVAILABLE only. */
  reason: SlotStatus.optional(),
  /** SLOT_UNAVAILABLE only; at most 5. */
  alternatives: z.array(AlternativeSlot).max(5).optional(),
});
export type Problem = z.infer<typeof Problem>;
