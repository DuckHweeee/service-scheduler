import type { DealershipList, ServiceTypeList, VehicleList } from '@scheduler/contracts';
import { routes } from '@scheduler/contracts';
import { dealerships, serviceTypes, vehicles } from '@scheduler/contracts/fixtures';
import { HttpResponse, http } from 'msw';
import { apiUrl } from '../../config.js';
import { getCustomer } from '../store.js';
import { notFound } from '../support.js';

export const referenceHandlers = [
  http.get(apiUrl(routes.dealerships), () =>
    HttpResponse.json({ items: dealerships } satisfies DealershipList),
  ),
  http.get(apiUrl(routes.serviceTypes), () =>
    HttpResponse.json({ items: serviceTypes } satisfies ServiceTypeList),
  ),
  http.get(apiUrl(routes.customer), ({ params }) => {
    const c = getCustomer(String(params.id));
    return c ? HttpResponse.json(c) : notFound('Customer');
  }),
  http.get(apiUrl(routes.customerVehicles), ({ params }) => {
    const id = String(params.id);
    if (!getCustomer(id)) return notFound('Customer');
    return HttpResponse.json({ items: vehicles.filter((v) => v.customerId === id) } satisfies VehicleList);
  }),
];
