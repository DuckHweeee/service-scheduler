// SPEC §7 reference data. Insert-only: call on an empty database (see `resetDatabase`).
import { sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../client.js';
import {
  customers,
  dealerships,
  inventory,
  parts,
  servicePartRequirements,
  serviceBays,
  serviceTypes,
  technicians,
  vehicles,
} from '../schema.js';

type Skill = 'GENERAL' | 'BRAKES' | 'ALIGNMENT' | 'EV_HIGH_VOLTAGE';

/** Empties every table and restarts identity/sequences so a re-seed is byte-for-byte reproducible. */
export const resetDatabase = async (db: Db): Promise<void> => {
  await db.execute(sql`TRUNCATE TABLE
    booking_events, appointment_parts, appointments, inventory, service_part_requirements, parts,
    vehicles, customers, service_types, technicians, service_bays, dealerships
    RESTART IDENTITY CASCADE`);
  await db.execute(sql`ALTER SEQUENCE appointment_ref_seq RESTART WITH 1`);
};

const DEALERSHIPS = [
  { id: 'DLR-01', name: 'Northside Service Center' },
  { id: 'DLR-02', name: 'Riverside Auto Care' },
  { id: 'DLR-03', name: 'Airport Road Service' },
];

const BAY_LAYOUT = [
  { name: 'Bay 1', bayType: 'GENERAL_LIFT' },
  { name: 'Bay 2', bayType: 'GENERAL_LIFT' },
  { name: 'Bay 3', bayType: 'ALIGNMENT_RACK' },
  { name: 'Bay 4', bayType: 'EV_ISOLATED' },
  { name: 'Bay 5', bayType: 'WASH_BAY' },
] as const;

const FULL_SKILLS: Skill[][] = [
  ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'],
  ['GENERAL', 'ALIGNMENT'],
  ['GENERAL', 'BRAKES'],
  ['GENERAL', 'EV_HIGH_VOLTAGE'],
];
const NO_ALIGNMENT_SKILLS: Skill[][] = [
  ['GENERAL', 'BRAKES', 'EV_HIGH_VOLTAGE'],
  ['GENERAL'],
  ['GENERAL', 'BRAKES'],
  ['GENERAL', 'EV_HIGH_VOLTAGE'],
];

const TECH_NAMES = [
  ['An Nguyen', 'Marco Ortiz', 'Riya Patel', 'Jin Kim'],
  ['Hana Berg', 'Tomas Silva', 'Priya Nair', 'Leo Chen'],
  ['Sam Okafor', 'Mei Tanaka', 'Omar Haddad', 'Lena Novak'],
];

const SERVICE_TYPES = [
  ['OIL_CHANGE', 'Oil and filter change', 45, 'GENERAL', ['GENERAL_LIFT', 'ALIGNMENT_RACK'], true, ['ICE']],
  ['GENERAL_INSPECTION', 'General inspection', 30, 'GENERAL', ['GENERAL_LIFT', 'ALIGNMENT_RACK'], true, ['ICE', 'EV']],
  ['AIR_FILTER_REPLACEMENT', 'Air filter replacement', 30, 'GENERAL', ['GENERAL_LIFT', 'ALIGNMENT_RACK'], true, ['ICE', 'EV']],
  ['TIRE_ROTATION', 'Tire rotation', 45, 'GENERAL', ['GENERAL_LIFT', 'ALIGNMENT_RACK'], true, ['ICE', 'EV']],
  ['CAR_WASH', 'Car wash', 30, 'GENERAL', ['WASH_BAY'], true, ['ICE', 'EV']],
  ['BRAKE_PAD_REPLACEMENT', 'Brake pad replacement', 120, 'BRAKES', ['GENERAL_LIFT', 'ALIGNMENT_RACK'], false, ['ICE', 'EV']],
  ['WHEEL_ALIGNMENT', 'Wheel alignment', 60, 'ALIGNMENT', ['ALIGNMENT_RACK'], false, ['ICE', 'EV']],
  ['EV_BATTERY_CHECK', 'High-voltage battery check', 90, 'EV_HIGH_VOLTAGE', ['EV_ISOLATED'], false, ['EV']],
] as const;

const PARTS = [
  ['OIL-5W30-4L', 'Engine oil 5W-30 4L'],
  ['FLT-OIL-CX22', 'Oil filter Crossover LX'],
  ['FLT-OIL-GEN', 'Oil filter (generic)'],
  ['FLT-AIR-CX22', 'Air filter Crossover LX'],
  ['FLT-CABIN-EV24', 'Cabin filter Compact EV'],
  ['FLT-AIR-GEN', 'Air filter (generic)'],
] as const;

const REQUIREMENTS = [
  ['OIL_CHANGE', 'Crossover LX', 'OIL-5W30-4L'],
  ['OIL_CHANGE', 'Crossover LX', 'FLT-OIL-CX22'],
  ['OIL_CHANGE', null, 'OIL-5W30-4L'],
  ['OIL_CHANGE', null, 'FLT-OIL-GEN'],
  ['AIR_FILTER_REPLACEMENT', 'Crossover LX', 'FLT-AIR-CX22'],
  ['AIR_FILTER_REPLACEMENT', 'Compact EV', 'FLT-CABIN-EV24'],
  ['AIR_FILTER_REPLACEMENT', null, 'FLT-AIR-GEN'],
] as const;

const BACKGROUND_VEHICLES = [
  { model: 'Crossover LX', year: 2022, powertrain: 'ICE' },
  { model: 'Compact EV', year: 2024, powertrain: 'EV' },
  { model: 'Sedan GT', year: 2020, powertrain: 'ICE' },
  { model: 'Hatch S', year: 2019, powertrain: 'ICE' },
  { model: 'Crossover LX', year: 2023, powertrain: 'ICE' },
  { model: 'Compact EV', year: 2023, powertrain: 'EV' },
] as const;

const BACKGROUND_NAMES = [
  'Minh Pham', 'Sofia Reyes', 'Daniel Weber', 'Aiko Sato', 'Hugo Martin', 'Nadia Karim',
  'Peter Lund', 'Chloe Bernard', 'Ravi Menon', 'Elena Rossi', 'Tuan Le', 'Grace Mwangi',
];

export const seedReferenceData = async (db: DbOrTx): Promise<void> => {
  await db.insert(dealerships).values(
    DEALERSHIPS.map((d) => ({
      ...d,
      timezone: 'Asia/Ho_Chi_Minh',
      opensAt: '08:00',
      closesAt: '17:00',
      workingDays: [1, 2, 3, 4, 5],
      sameDayLeadMin: 120,
      sameDayQuotaPct: 20,
      lateGraceMin: 15,
    })),
  );

  await db.insert(serviceBays).values(
    DEALERSHIPS.flatMap((d, di) =>
      BAY_LAYOUT.map((b, bi) => ({
        id: `BAY-${String(di * 5 + bi + 1).padStart(2, '0')}`,
        dealershipId: d.id,
        name: b.name,
        bayType: b.bayType,
      })),
    ),
  );

  await db.insert(technicians).values(
    DEALERSHIPS.flatMap((d, di) =>
      (di === 2 ? NO_ALIGNMENT_SKILLS : FULL_SKILLS).map((skills, ti) => ({
        id: `TEC-${String(di * 4 + ti + 1).padStart(2, '0')}`,
        dealershipId: d.id,
        name: TECH_NAMES[di]![ti]!,
        skills,
      })),
    ),
  );

  await db.insert(serviceTypes).values(
    SERVICE_TYPES.map(([code, name, durationMin, requiredSkill, allowedBayTypes, isExpress, powertrains]) => ({
      code,
      name,
      durationMin,
      requiredSkill,
      allowedBayTypes: [...allowedBayTypes],
      isExpress,
      powertrains: [...powertrains],
    })),
  );

  await db.insert(parts).values(PARTS.map(([sku, name]) => ({ sku, name })));
  await db.insert(servicePartRequirements).values(
    REQUIREMENTS.map(([serviceTypeCode, vehicleModel, sku]) => ({ serviceTypeCode, vehicleModel, sku, qty: 1 })),
  );

  await db.insert(inventory).values(
    DEALERSHIPS.flatMap((d) =>
      PARTS.map(([sku]) => ({
        dealershipId: d.id,
        sku,
        onHand: d.id === 'DLR-02' && sku === 'FLT-OIL-CX22' ? 0 : 10,
        reserved: 0,
      })),
    ),
  );

  await db.insert(customers).values([
    { id: 'CUS-10482', fullName: 'Linh Tran', phone: '+84 90 123 4567', email: 'linh.tran@example.com' },
    ...BACKGROUND_NAMES.map((fullName, i) => ({
      id: `CUS-${10001 + i}`,
      fullName,
      phone: `+84 90 555 ${String(1000 + i)}`,
      email: `${fullName.toLowerCase().replace(' ', '.')}@example.com`,
    })),
  ]);

  await db.insert(vehicles).values([
    {
      id: 'VEH-01', customerId: 'CUS-10482', modelYear: 2022, modelName: 'Crossover LX', powertrain: 'ICE',
      vin: 'KL1CX22LXNB104821', plate: '51F-238.47',
    },
    {
      id: 'VEH-02', customerId: 'CUS-10482', modelYear: 2024, modelName: 'Compact EV', powertrain: 'EV',
      vin: 'KLEV24CMPRB200937', plate: '51H-902.15',
    },
    ...BACKGROUND_NAMES.map((_, i) => {
      const v = BACKGROUND_VEHICLES[i % BACKGROUND_VEHICLES.length]!;
      return {
        id: `VEH-${String(i + 3).padStart(2, '0')}`,
        customerId: `CUS-${10001 + i}`,
        modelYear: v.year,
        modelName: v.model,
        powertrain: v.powertrain,
        vin: `KLBG0000000000${String(i + 1).padStart(3, '0')}`, // 17 chars, invented
        plate: `51G-${String(100 + i * 7).padStart(3, '0')}.${String(10 + i)}`,
      };
    }),
  ]);
};
