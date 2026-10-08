// In-memory mock "database", seeded from the shared contract fixtures (mirrors SPEC §7).
import type { AppointmentStatus, BayType, BookingChannel, HistoryEntry, Skill } from '@scheduler/contracts';
import {
  appointmentDetailExample,
  currentCustomer,
  dealerships,
  serviceTypes,
  vehicles,
} from '@scheduler/contracts/fixtures';
import { parseMin, zonedToMs } from '../lib/time.js';

export interface MockBay {
  id: string;
  name: string;
  bayType: BayType;
}
export interface MockTech {
  id: string;
  name: string;
  skills: Skill[];
}
export interface MockAppointment {
  reference: string;
  status: AppointmentStatus;
  channel: BookingChannel;
  customerId: string;
  vehicleId: string;
  dealershipId: string;
  serviceTypeCode: string;
  technicianId: string;
  bayId: string;
  date: string;
  startMin: number;
  endMin: number;
  createdAtMs: number;
  checkedInAtMs: number | null;
  cancelledAtMs: number | null;
  bookingSessionId: string;
  parts: { sku: string; qty: number; released: boolean }[];
  history: HistoryEntry[];
}
export interface MockStockLine {
  onHand: number;
  reserved: number;
  updatedAtMs: number;
}

export const PARTS: { sku: string; name: string }[] = [
  { sku: 'OIL-5W30-4L', name: 'Engine oil 5W-30 4L' },
  { sku: 'FLT-OIL-CX22', name: 'Oil filter Crossover LX' },
  { sku: 'FLT-OIL-GEN', name: 'Oil filter (generic)' },
  { sku: 'FLT-AIR-CX22', name: 'Air filter Crossover LX' },
  { sku: 'FLT-CABIN-EV24', name: 'Cabin filter Compact EV' },
  { sku: 'FLT-AIR-GEN', name: 'Air filter (generic)' },
];

/** SPEC §7: a model-specific row replaces the NULL (any model) rows for that model. */
const REQUIREMENTS: { service: string; model: string | null; sku: string; qty: number }[] = [
  { service: 'OIL_CHANGE', model: 'Crossover LX', sku: 'OIL-5W30-4L', qty: 1 },
  { service: 'OIL_CHANGE', model: 'Crossover LX', sku: 'FLT-OIL-CX22', qty: 1 },
  { service: 'OIL_CHANGE', model: null, sku: 'OIL-5W30-4L', qty: 1 },
  { service: 'OIL_CHANGE', model: null, sku: 'FLT-OIL-GEN', qty: 1 },
  { service: 'AIR_FILTER_REPLACEMENT', model: 'Crossover LX', sku: 'FLT-AIR-CX22', qty: 1 },
  { service: 'AIR_FILTER_REPLACEMENT', model: 'Compact EV', sku: 'FLT-CABIN-EV24', qty: 1 },
  { service: 'AIR_FILTER_REPLACEMENT', model: null, sku: 'FLT-AIR-GEN', qty: 1 },
];

export function partRequirements(serviceCode: string, modelName: string): { sku: string; qty: number }[] {
  const rows = REQUIREMENTS.filter((r) => r.service === serviceCode);
  const specific = rows.filter((r) => r.model === modelName);
  return (specific.length ? specific : rows.filter((r) => r.model === null)).map((r) => ({
    sku: r.sku,
    qty: r.qty,
  }));
}

const bayLayout: [string, BayType][] = [
  ['Bay 1', 'GENERAL_LIFT'],
  ['Bay 2', 'GENERAL_LIFT'],
  ['Bay 3', 'ALIGNMENT_RACK'],
  ['Bay 4', 'EV_ISOLATED'],
  ['Bay 5', 'WASH_BAY'],
];

function techsFor(index: number): MockTech[] {
  const id = (n: number) => `TEC-${String(index * 4 + n).padStart(2, '0')}`;
  if (index === 0) {
    return [
      { id: id(1), name: 'An Nguyen', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'] },
      { id: id(2), name: 'Marco Ortiz', skills: ['GENERAL', 'ALIGNMENT'] },
      { id: id(3), name: 'Riya Patel', skills: ['GENERAL', 'BRAKES'] },
      { id: id(4), name: 'Jin Kim', skills: ['GENERAL', 'EV_HIGH_VOLTAGE'] },
    ];
  }
  if (index === 1) {
    return [
      { id: id(1), name: 'Thao Le', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'] },
      { id: id(2), name: 'Samir Khan', skills: ['GENERAL', 'ALIGNMENT'] },
      { id: id(3), name: 'Elena Petrova', skills: ['GENERAL', 'BRAKES'] },
      { id: id(4), name: 'Quang Pham', skills: ['GENERAL', 'EV_HIGH_VOLTAGE'] },
    ];
  }
  // DLR-03 has no ALIGNMENT skill.
  return [
    { id: id(1), name: 'Hana Sato', skills: ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'] },
    { id: id(2), name: 'Luis Romero', skills: ['GENERAL'] },
    { id: id(3), name: 'Mai Vo', skills: ['GENERAL', 'BRAKES'] },
    { id: id(4), name: 'Ben Carter', skills: ['GENERAL', 'EV_HIGH_VOLTAGE'] },
  ];
}

export interface MockStore {
  bays: Record<string, MockBay[]>;
  techs: Record<string, MockTech[]>;
  inventory: Record<string, Record<string, MockStockLine>>;
  appointments: MockAppointment[];
  nextRef: number;
  idempotency: Map<string, string>;
  conflictConsumed: boolean;
}

function seedAppointment(): MockAppointment {
  const a = appointmentDetailExample;
  const tz = a.dealership.timezone;
  return {
    reference: a.reference,
    status: a.status,
    channel: a.channel,
    customerId: a.customer.id,
    vehicleId: a.vehicle.id,
    dealershipId: a.dealership.id,
    serviceTypeCode: a.serviceType.code,
    technicianId: a.technician.id,
    bayId: a.serviceBay.id,
    date: a.localDate,
    startMin: parseMin(a.startTime),
    endMin: parseMin(a.endTime),
    createdAtMs: zonedToMs(a.createdAt.slice(0, 10), parseMin(a.createdAt.slice(11, 16)), tz),
    checkedInAtMs: null,
    cancelledAtMs: null,
    bookingSessionId: '00000000-0000-4000-8000-000000000001',
    parts: [],
    history: a.history,
  };
}

function createStore(): MockStore {
  const bays: MockStore['bays'] = {};
  const techs: MockStore['techs'] = {};
  const inventory: MockStore['inventory'] = {};
  dealerships.forEach((d, i) => {
    bays[d.id] = bayLayout.map(([name, bayType], n) => ({
      id: `BAY-${String(i * 5 + n + 1).padStart(2, '0')}`,
      name,
      bayType,
    }));
    techs[d.id] = techsFor(i);
    inventory[d.id] = Object.fromEntries(
      PARTS.map((p) => [
        p.sku,
        {
          onHand: d.id === 'DLR-02' && p.sku === 'FLT-OIL-CX22' ? 0 : 10,
          reserved: 0,
          updatedAtMs: Date.now(),
        },
      ]),
    );
  });
  return {
    bays,
    techs,
    inventory,
    appointments: [seedAppointment()],
    nextRef: 410,
    idempotency: new Map(),
    conflictConsumed: false,
  };
}

export const store: MockStore = createStore();

/** Restore the pristine seed (used by tests and by the dev "reset" convenience). */
export function resetStore(): void {
  Object.assign(store, createStore());
}

export const getDealership = (id: string) => dealerships.find((d) => d.id === id);
export const getServiceType = (code: string) => serviceTypes.find((s) => s.code === code);
export const getVehicle = (id: string) => vehicles.find((v) => v.id === id);
export const getCustomer = (id: string) => (id === currentCustomer.id ? currentCustomer : undefined);
