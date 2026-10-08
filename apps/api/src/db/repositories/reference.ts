// Reference-data lookups. Every function takes `DbOrTx` first and returns plain typed rows
// (times as `HH:mm` strings, arrays as arrays). Missing single rows resolve to `null`.
import type { BayType, Powertrain, Skill } from '@scheduler/contracts';
import { asc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../client.js';
import { customers, dealerships, serviceBays, serviceTypes, technicians, vehicles } from '../schema.js';

export interface DealershipRow {
  id: string;
  name: string;
  timezone: string;
  /** `HH:mm` */
  opensAt: string;
  /** `HH:mm` */
  closesAt: string;
  /** ISO weekdays, 1 = Monday. */
  workingDays: number[];
  sameDayLeadMin: number;
  sameDayQuotaPct: number;
  lateGraceMin: number;
}

export interface ServiceTypeRow {
  code: string;
  name: string;
  durationMin: number;
  requiredSkill: Skill;
  /** Preference order. */
  allowedBayTypes: BayType[];
  isExpress: boolean;
  powertrains: Powertrain[];
}

export interface CustomerRow {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
}

export interface VehicleRow {
  id: string;
  customerId: string;
  modelYear: number;
  modelName: string;
  powertrain: Powertrain;
  vin: string;
  plate: string | null;
}

export interface BayRow {
  id: string;
  dealershipId: string;
  name: string;
  bayType: BayType;
}

export interface TechnicianRow {
  id: string;
  dealershipId: string;
  name: string;
  skills: Skill[];
}

const hhmm = (t: string): string => t.slice(0, 5);

const toDealership = (r: typeof dealerships.$inferSelect): DealershipRow => ({
  ...r,
  opensAt: hhmm(r.opensAt),
  closesAt: hhmm(r.closesAt),
});

export const listDealerships = async (db: DbOrTx): Promise<DealershipRow[]> =>
  (await db.select().from(dealerships).orderBy(asc(dealerships.id))).map(toDealership);

export const getDealership = async (db: DbOrTx, id: string): Promise<DealershipRow | null> => {
  const [row] = await db.select().from(dealerships).where(eq(dealerships.id, id));
  return row ? toDealership(row) : null;
};

export const listServiceTypes = async (db: DbOrTx): Promise<ServiceTypeRow[]> =>
  db.select().from(serviceTypes).orderBy(asc(serviceTypes.code));

export const getServiceType = async (db: DbOrTx, code: string): Promise<ServiceTypeRow | null> => {
  const [row] = await db.select().from(serviceTypes).where(eq(serviceTypes.code, code));
  return row ?? null;
};

export const getCustomer = async (db: DbOrTx, id: string): Promise<CustomerRow | null> => {
  const [row] = await db.select().from(customers).where(eq(customers.id, id));
  return row ?? null;
};

export const getVehicle = async (db: DbOrTx, id: string): Promise<VehicleRow | null> => {
  const [row] = await db.select().from(vehicles).where(eq(vehicles.id, id));
  return row ? { ...row, vin: row.vin.trim() } : null;
};

export const listVehiclesByCustomer = async (db: DbOrTx, customerId: string): Promise<VehicleRow[]> =>
  (await db.select().from(vehicles).where(eq(vehicles.customerId, customerId)).orderBy(asc(vehicles.id))).map(
    (r) => ({ ...r, vin: r.vin.trim() }),
  );

export const listBays = async (db: DbOrTx, dealershipId: string): Promise<BayRow[]> =>
  db.select().from(serviceBays).where(eq(serviceBays.dealershipId, dealershipId)).orderBy(asc(serviceBays.id));

export const listTechnicians = async (db: DbOrTx, dealershipId: string): Promise<TechnicianRow[]> =>
  db.select().from(technicians).where(eq(technicians.dealershipId, dealershipId)).orderBy(asc(technicians.id));
