// Typed sample payloads that mirror the seed data (SPEC §7). Used by web mocks (MSW) and contract tests.
// Keep in sync with SPEC §7 — if they disagree, SPEC wins.
import type {
  AppointmentDetail,
  AppointmentSummary,
  AvailabilityResponse,
  BoardResponse,
  Customer,
  Dealership,
  InventoryItem,
  Problem,
  ServiceType,
  Vehicle,
} from './schemas.js';

const policy = { leadTimeMin: 120, quotaPct: 20, lateGraceMin: 15 };
const hours = { opensAt: '08:00', closesAt: '17:00', workingDays: [1, 2, 3, 4, 5], bayCount: 5 };

export const dealerships: Dealership[] = [
  { id: 'DLR-01', name: 'Northside Service Center', timezone: 'Asia/Ho_Chi_Minh', ...hours, sameDayPolicy: policy },
  { id: 'DLR-02', name: 'Riverside Auto Care', timezone: 'Asia/Ho_Chi_Minh', ...hours, sameDayPolicy: policy },
  { id: 'DLR-03', name: 'Airport Road Service', timezone: 'Asia/Ho_Chi_Minh', ...hours, sameDayPolicy: policy },
];

const generalBays = ['GENERAL_LIFT', 'ALIGNMENT_RACK'] as const;
export const serviceTypes: ServiceType[] = [
  { code: 'OIL_CHANGE', name: 'Oil and filter change', durationMin: 45, requiredSkill: 'GENERAL', allowedBayTypes: [...generalBays], isExpress: true, powertrains: ['ICE'] },
  { code: 'GENERAL_INSPECTION', name: 'General inspection', durationMin: 30, requiredSkill: 'GENERAL', allowedBayTypes: [...generalBays], isExpress: true, powertrains: ['ICE', 'EV'] },
  { code: 'AIR_FILTER_REPLACEMENT', name: 'Air filter replacement', durationMin: 30, requiredSkill: 'GENERAL', allowedBayTypes: [...generalBays], isExpress: true, powertrains: ['ICE', 'EV'] },
  { code: 'TIRE_ROTATION', name: 'Tire rotation', durationMin: 45, requiredSkill: 'GENERAL', allowedBayTypes: [...generalBays], isExpress: true, powertrains: ['ICE', 'EV'] },
  { code: 'CAR_WASH', name: 'Car wash', durationMin: 30, requiredSkill: 'GENERAL', allowedBayTypes: ['WASH_BAY'], isExpress: true, powertrains: ['ICE', 'EV'] },
  { code: 'BRAKE_PAD_REPLACEMENT', name: 'Brake pad replacement', durationMin: 120, requiredSkill: 'BRAKES', allowedBayTypes: [...generalBays], isExpress: false, powertrains: ['ICE', 'EV'] },
  { code: 'WHEEL_ALIGNMENT', name: 'Wheel alignment', durationMin: 60, requiredSkill: 'ALIGNMENT', allowedBayTypes: ['ALIGNMENT_RACK'], isExpress: false, powertrains: ['ICE', 'EV'] },
  { code: 'EV_BATTERY_CHECK', name: 'High-voltage battery check', durationMin: 90, requiredSkill: 'EV_HIGH_VOLTAGE', allowedBayTypes: ['EV_ISOLATED'], isExpress: false, powertrains: ['EV'] },
];

export const currentCustomer: Customer = {
  id: 'CUS-10482',
  fullName: 'Linh Tran',
  phone: '+84 90 123 4567',
  email: 'linh.tran@example.com',
};

export const vehicles: Vehicle[] = [
  { id: 'VEH-01', customerId: 'CUS-10482', modelYear: 2022, modelName: 'Crossover LX', powertrain: 'ICE', vinLast4: '4821', plate: '51F-238.47' },
  { id: 'VEH-02', customerId: 'CUS-10482', modelYear: 2024, modelName: 'Compact EV', powertrain: 'EV', vinLast4: '0937', plate: '51H-902.15' },
];

export const dlr01Bays = [
  { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT' },
  { id: 'BAY-02', name: 'Bay 2', bayType: 'GENERAL_LIFT' },
  { id: 'BAY-03', name: 'Bay 3', bayType: 'ALIGNMENT_RACK' },
  { id: 'BAY-04', name: 'Bay 4', bayType: 'EV_ISOLATED' },
  { id: 'BAY-05', name: 'Bay 5', bayType: 'WASH_BAY' },
] as const;

export const dlr01Technicians = [
  { id: 'TEC-01', name: 'An Nguyen', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'] },
  { id: 'TEC-02', name: 'Marco Ortiz', skills: ['GENERAL', 'ALIGNMENT'] },
  { id: 'TEC-03', name: 'Riya Patel', skills: ['GENERAL', 'BRAKES'] },
  { id: 'TEC-04', name: 'Jin Kim', skills: ['GENERAL', 'EV_HIGH_VOLTAGE'] },
] as const;

/** Brake pad replacement at DLR-01 on a future day: two slots shown, one free and one rejected. */
export const availabilityExample: AvailabilityResponse = {
  dealershipId: 'DLR-01',
  serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
  date: '2026-10-09',
  timezone: 'Asia/Ho_Chi_Minh',
  isWorkingDay: true,
  durationMin: 120,
  sameDay: null,
  slots: [
    {
      startTime: '08:00',
      endTime: '10:00',
      startAt: '2026-10-09T08:00:00+07:00',
      status: 'AVAILABLE',
      isExpress: false,
      proposed: {
        serviceBay: { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT' },
        technician: { id: 'TEC-03', name: 'Riya Patel' },
      },
    },
    {
      startTime: '10:00',
      endTime: '12:00',
      startAt: '2026-10-09T10:00:00+07:00',
      status: 'NO_QUALIFIED_TECHNICIAN',
      isExpress: false,
      proposed: null,
    },
  ],
};

/** Same-day oil change at DLR-01, now = 09:10 → earliest start 11:30. */
export const sameDayAvailabilityExample: AvailabilityResponse = {
  dealershipId: 'DLR-01',
  serviceTypeCode: 'OIL_CHANGE',
  date: '2026-10-08',
  timezone: 'Asia/Ho_Chi_Minh',
  isWorkingDay: true,
  durationMin: 45,
  sameDay: { isSameDay: true, blocked: null, earliestStartTime: '11:30', leadTimeMin: 120, quotaCap: 1, lateGraceMin: 15 },
  slots: [
    {
      startTime: '11:30',
      endTime: '12:15',
      startAt: '2026-10-08T11:30:00+07:00',
      status: 'AVAILABLE',
      isExpress: true,
      proposed: {
        serviceBay: { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT' },
        technician: { id: 'TEC-02', name: 'Marco Ortiz' },
      },
    },
    { startTime: '12:00', endTime: '12:45', startAt: '2026-10-08T12:00:00+07:00', status: 'SAME_DAY_QUOTA_REACHED', isExpress: true, proposed: null },
  ],
};

export const appointmentDetailExample: AppointmentDetail = {
  reference: 'APT-20261008-0409',
  status: 'CONFIRMED',
  channel: 'ADVANCE',
  startAt: '2026-10-08T13:00:00+07:00',
  endAt: '2026-10-08T15:00:00+07:00',
  localDate: '2026-10-08',
  startTime: '13:00',
  endTime: '15:00',
  durationMin: 120,
  createdAt: '2026-10-07T14:02:42+07:00',
  checkedInAt: null,
  cancelledAt: null,
  lateGraceMin: 15,
  customer: currentCustomer,
  vehicle: vehicles[0]!,
  dealership: { id: 'DLR-01', name: 'Northside Service Center', timezone: 'Asia/Ho_Chi_Minh' },
  serviceType: { code: 'BRAKE_PAD_REPLACEMENT', name: 'Brake pad replacement', requiredSkill: 'BRAKES', isExpress: false },
  technician: { id: 'TEC-03', name: 'Riya Patel', skills: ['GENERAL', 'BRAKES'] },
  serviceBay: { id: 'BAY-02', name: 'Bay 2', bayType: 'GENERAL_LIFT' },
  parts: [],
  history: [
    { type: 'SLOT_REQUESTED', occurredAt: '2026-10-07T14:02:09+07:00', summary: 'Requested 10:00–12:00', detail: { startTime: '10:00' } },
    { type: 'CHECK_FAILED', occurredAt: '2026-10-07T14:02:09+07:00', summary: 'Check failed: no Brakes-qualified technician free for the full window. Five alternatives offered.', detail: { reason: 'NO_QUALIFIED_TECHNICIAN', alternatives: 5 } },
    { type: 'SLOT_REQUESTED', occurredAt: '2026-10-07T14:02:41+07:00', summary: 'Customer chose 13:00–15:00', detail: { startTime: '13:00' } },
    { type: 'CHECK_PASSED', occurredAt: '2026-10-07T14:02:41+07:00', summary: 'Check passed: Bay 2 and Riya Patel free 13:00–15:00', detail: { bayId: 'BAY-02', technicianId: 'TEC-03' } },
    { type: 'RESOURCES_RESERVED', occurredAt: '2026-10-07T14:02:42+07:00', summary: 'Bay and technician reserved together', detail: {} },
    { type: 'APPOINTMENT_CREATED', occurredAt: '2026-10-07T14:02:42+07:00', summary: 'Appointment record created · confirmation sent', detail: {} },
  ],
};

/** The appointment above after `POST …/reschedule` to Fri 9 Oct 10:00 (SPEC §6.5): same reference, new slot. */
export const rescheduledAppointmentExample: AppointmentDetail = {
  ...appointmentDetailExample,
  startAt: '2026-10-09T10:00:00+07:00',
  endAt: '2026-10-09T12:00:00+07:00',
  localDate: '2026-10-09',
  startTime: '10:00',
  endTime: '12:00',
  technician: { id: 'TEC-01', name: 'An Nguyen', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'] },
  serviceBay: { id: 'BAY-01', name: 'Bay 1', bayType: 'GENERAL_LIFT' },
  history: [
    ...appointmentDetailExample.history,
    {
      type: 'APPOINTMENT_RESCHEDULED',
      occurredAt: '2026-10-08T09:15:00+07:00',
      summary: 'Rescheduled from Thu 8 Oct 13:00 to Fri 9 Oct 10:00 — Bay 1, An Nguyen',
      detail: {
        from: { date: '2026-10-08', startTime: '13:00', endTime: '15:00', technicianId: 'TEC-03', bayId: 'BAY-02', channel: 'ADVANCE' },
        to: { date: '2026-10-09', startTime: '10:00', endTime: '12:00', technicianId: 'TEC-01', bayId: 'BAY-01', channel: 'ADVANCE' },
      },
    },
  ],
};

export const appointmentSummaryExample: AppointmentSummary = {
  reference: appointmentDetailExample.reference,
  status: appointmentDetailExample.status,
  channel: appointmentDetailExample.channel,
  startAt: appointmentDetailExample.startAt,
  endAt: appointmentDetailExample.endAt,
  localDate: appointmentDetailExample.localDate,
  startTime: appointmentDetailExample.startTime,
  endTime: appointmentDetailExample.endTime,
  durationMin: appointmentDetailExample.durationMin,
  dealership: { id: 'DLR-01', name: 'Northside Service Center' },
  serviceType: { code: 'BRAKE_PAD_REPLACEMENT', name: 'Brake pad replacement' },
  vehicle: { id: 'VEH-01', modelYear: 2022, modelName: 'Crossover LX', plate: '51F-238.47' },
};

const block = (reference: string, code: string, name: string, start: string, end: string) => ({
  reference,
  status: 'CONFIRMED' as const,
  channel: 'ADVANCE' as const,
  serviceTypeCode: code,
  serviceTypeName: name,
  startTime: start,
  endTime: end,
  startAt: `2026-10-08T${start}:00+07:00`,
  endAt: `2026-10-08T${end}:00+07:00`,
  checkedInAt: null,
});

export const boardExample: BoardResponse = {
  dealership: { id: 'DLR-01', name: 'Northside Service Center', timezone: 'Asia/Ho_Chi_Minh' },
  date: '2026-10-08',
  isWorkingDay: true,
  opensAt: '08:00',
  closesAt: '17:00',
  bays: [
    { ...dlr01Bays[0], blocks: [block('APT-20261008-0398', 'OIL_CHANGE', 'Oil and filter change', '08:30', '09:15')] },
    { ...dlr01Bays[1], blocks: [block('APT-20261008-0409', 'BRAKE_PAD_REPLACEMENT', 'Brake pad replacement', '13:00', '15:00')] },
    { ...dlr01Bays[2], blocks: [] },
    { ...dlr01Bays[3], blocks: [] },
    { ...dlr01Bays[4], blocks: [] },
  ],
  technicians: [
    { ...dlr01Technicians[0], skills: [...dlr01Technicians[0].skills], blocks: [] },
    { ...dlr01Technicians[1], skills: [...dlr01Technicians[1].skills], blocks: [block('APT-20261008-0398', 'OIL_CHANGE', 'Oil and filter change', '08:30', '09:15')] },
    { ...dlr01Technicians[2], skills: [...dlr01Technicians[2].skills], blocks: [block('APT-20261008-0409', 'BRAKE_PAD_REPLACEMENT', 'Brake pad replacement', '13:00', '15:00')] },
    { ...dlr01Technicians[3], skills: [...dlr01Technicians[3].skills], blocks: [] },
  ],
};

export const inventoryExample: InventoryItem[] = [
  { sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 4L', onHand: 10, reserved: 1, available: 9, updatedAt: '2026-10-08T07:00:00+07:00' },
  { sku: 'FLT-OIL-CX22', name: 'Oil filter Crossover LX', onHand: 10, reserved: 1, available: 9, updatedAt: '2026-10-08T07:00:00+07:00' },
];

export const slotUnavailableProblemExample: Problem = {
  type: 'https://scheduler.example/problems/slot-unavailable',
  title: 'Slot unavailable',
  status: 409,
  code: 'SLOT_UNAVAILABLE',
  detail: 'No Brakes-qualified technician is free for the full window 10:00–12:00.',
  reason: 'NO_QUALIFIED_TECHNICIAN',
  alternatives: [
    { date: '2026-10-09', startTime: '11:00', endTime: '13:00', startAt: '2026-10-09T11:00:00+07:00' },
    { date: '2026-10-09', startTime: '11:30', endTime: '13:30', startAt: '2026-10-09T11:30:00+07:00' },
    { date: '2026-10-09', startTime: '12:00', endTime: '14:00', startAt: '2026-10-09T12:00:00+07:00' },
    { date: '2026-10-09', startTime: '12:30', endTime: '14:30', startAt: '2026-10-09T12:30:00+07:00' },
    { date: '2026-10-09', startTime: '13:00', endTime: '15:00', startAt: '2026-10-09T13:00:00+07:00' },
  ],
};
