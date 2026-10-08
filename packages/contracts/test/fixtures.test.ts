import { describe, expect, it } from 'vitest';
import * as f from '../src/fixtures.js';
import {
  AppointmentDetail,
  AppointmentSummary,
  AvailabilityResponse,
  BoardResponse,
  CreateAppointmentRequest,
  Dealership,
  InventoryItem,
  Problem,
  ServiceType,
  Vehicle,
} from '../src/index.js';

describe('fixtures conform to the contract', () => {
  it.each([
    ['dealerships', Dealership.array(), f.dealerships],
    ['serviceTypes', ServiceType.array(), f.serviceTypes],
    ['vehicles', Vehicle.array(), f.vehicles],
    ['availability', AvailabilityResponse, f.availabilityExample],
    ['sameDayAvailability', AvailabilityResponse, f.sameDayAvailabilityExample],
    ['appointmentDetail', AppointmentDetail, f.appointmentDetailExample],
    ['appointmentSummary', AppointmentSummary, f.appointmentSummaryExample],
    ['board', BoardResponse, f.boardExample],
    ['inventory', InventoryItem.array(), f.inventoryExample],
    ['problem', Problem, f.slotUnavailableProblemExample],
  ] as const)('%s', (_name, schema, value) => {
    expect(() => schema.parse(value)).not.toThrow();
  });
});

describe('request validation', () => {
  const valid = {
    customerId: 'CUS-10482',
    vehicleId: 'VEH-01',
    dealershipId: 'DLR-01',
    serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
    date: '2026-10-09',
    startTime: '13:00',
    bookingSessionId: '8b0c3c1e-2f4a-4d7b-9c1a-0e5f6a7b8c9d',
  };

  it('accepts a well-formed booking', () => {
    expect(CreateAppointmentRequest.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['bad date', { date: '2026-13-01' }],
    ['bad time', { startTime: '25:00' }],
    ['non-uuid session', { bookingSessionId: 'abc' }],
  ])('rejects %s', (_name, patch) => {
    expect(CreateAppointmentRequest.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});
