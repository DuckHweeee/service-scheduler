// Single source of truth for URL shapes, shared by the API router and the web client.

export const API_PREFIX = '/api/v1';

export const paths = {
  dealerships: `${API_PREFIX}/dealerships`,
  serviceTypes: `${API_PREFIX}/service-types`,
  customer: (id: string) => `${API_PREFIX}/customers/${encodeURIComponent(id)}`,
  customerVehicles: (id: string) => `${API_PREFIX}/customers/${encodeURIComponent(id)}/vehicles`,
  availability: (dealershipId: string) => `${API_PREFIX}/dealerships/${encodeURIComponent(dealershipId)}/availability`,
  board: (dealershipId: string) => `${API_PREFIX}/dealerships/${encodeURIComponent(dealershipId)}/board`,
  inventory: (dealershipId: string) => `${API_PREFIX}/dealerships/${encodeURIComponent(dealershipId)}/inventory`,
  inventoryItem: (dealershipId: string, sku: string) =>
    `${API_PREFIX}/dealerships/${encodeURIComponent(dealershipId)}/inventory/${encodeURIComponent(sku)}`,
  appointments: `${API_PREFIX}/appointments`,
  appointment: (reference: string) => `${API_PREFIX}/appointments/${encodeURIComponent(reference)}`,
  cancelAppointment: (reference: string) => `${API_PREFIX}/appointments/${encodeURIComponent(reference)}/cancel`,
  checkIn: (reference: string) => `${API_PREFIX}/appointments/${encodeURIComponent(reference)}/check-in`,
  rescheduleAppointment: (reference: string) =>
    `${API_PREFIX}/appointments/${encodeURIComponent(reference)}/reschedule`,
} as const;

/** Fastify route patterns (same shapes as `paths`, with `:params`). */
export const routes = {
  dealerships: `${API_PREFIX}/dealerships`,
  serviceTypes: `${API_PREFIX}/service-types`,
  customer: `${API_PREFIX}/customers/:id`,
  customerVehicles: `${API_PREFIX}/customers/:id/vehicles`,
  availability: `${API_PREFIX}/dealerships/:id/availability`,
  board: `${API_PREFIX}/dealerships/:id/board`,
  inventory: `${API_PREFIX}/dealerships/:id/inventory`,
  inventoryItem: `${API_PREFIX}/dealerships/:id/inventory/:sku`,
  appointments: `${API_PREFIX}/appointments`,
  appointment: `${API_PREFIX}/appointments/:reference`,
  cancelAppointment: `${API_PREFIX}/appointments/:reference/cancel`,
  checkIn: `${API_PREFIX}/appointments/:reference/check-in`,
  rescheduleAppointment: `${API_PREFIX}/appointments/:reference/reschedule`,
} as const;

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const REQUEST_ID_HEADER = 'x-request-id';
