// A3: reference data routes (SPEC §6).
import { Customer, DealershipList, IdParams, ServiceTypeList, VehicleList, routes } from '@scheduler/contracts';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  getCustomer,
  listBays,
  listDealerships,
  listServiceTypes,
  listVehiclesByCustomer,
} from '../db/repositories/index.js';
import { notFound } from '../domain/errors.js';

export default async function referenceRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(routes.dealerships, { schema: { response: { 200: DealershipList } } }, async () => {
    const rows = await listDealerships(app.db);
    const items = await Promise.all(
      rows.map(async (d) => ({
        id: d.id,
        name: d.name,
        timezone: d.timezone,
        opensAt: d.opensAt,
        closesAt: d.closesAt,
        workingDays: d.workingDays,
        bayCount: (await listBays(app.db, d.id)).length,
        sameDayPolicy: { leadTimeMin: d.sameDayLeadMin, quotaPct: d.sameDayQuotaPct, lateGraceMin: d.lateGraceMin },
      })),
    );
    return { items };
  });

  app.get(routes.serviceTypes, { schema: { response: { 200: ServiceTypeList } } }, async () => ({
    items: await listServiceTypes(app.db),
  }));

  app.get(routes.customer, { schema: { params: IdParams, response: { 200: Customer } } }, async (req) => {
    const c = await getCustomer(app.db, req.params.id);
    if (!c) throw notFound('Customer', req.params.id);
    return c;
  });

  app.get(routes.customerVehicles, { schema: { params: IdParams, response: { 200: VehicleList } } }, async (req) => {
    const c = await getCustomer(app.db, req.params.id);
    if (!c) throw notFound('Customer', req.params.id);
    const rows = await listVehiclesByCustomer(app.db, c.id);
    return {
      items: rows.map((v) => ({
        id: v.id,
        customerId: v.customerId,
        modelYear: v.modelYear,
        modelName: v.modelName,
        powertrain: v.powertrain,
        vinLast4: v.vin.slice(-4),
        plate: v.plate,
      })),
    };
  });
}
