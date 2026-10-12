import {
  AppointmentDetail,
  AppointmentList,
  AvailabilityResponse,
  BoardResponse,
  Customer,
  DealershipList,
  InventoryItem,
  InventoryList,
  ServiceTypeList,
  VehicleList,
  paths,
} from '@scheduler/contracts';
import type {
  AppointmentStatus,
  AvailabilityQuery,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  RescheduleAppointmentRequest,
  UpdateInventoryRequest,
} from '@scheduler/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, request } from './client.js';

export const keys = {
  dealerships: ['dealerships'] as const,
  serviceTypes: ['service-types'] as const,
  customer: (id: string) => ['customers', id] as const,
  vehicles: (customerId: string) => ['customers', customerId, 'vehicles'] as const,
  availabilityAll: ['availability'] as const,
  availability: (dealershipId: string, q: AvailabilityQuery) =>
    ['availability', dealershipId, q.serviceType, q.date, q.vehicleId, q.excludeReference ?? null] as const,
  appointmentsAll: ['appointments'] as const,
  appointments: (customerId: string, status?: AppointmentStatus) =>
    ['appointments', 'list', customerId, status ?? 'all'] as const,
  appointment: (reference: string) => ['appointments', 'detail', reference] as const,
  boardAll: ['board'] as const,
  board: (dealershipId: string, date: string) => ['board', dealershipId, date] as const,
  inventory: (dealershipId: string) => ['inventory', dealershipId] as const,
};

const STATIC = { staleTime: 5 * 60_000 } as const;

/** Reference data that does not change during a session should not be retried on 4xx. */
const retry = (count: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2;

// ---------- reference data ----------

export const useDealerships = () =>
  useQuery({
    queryKey: keys.dealerships,
    queryFn: ({ signal }) => request(paths.dealerships, { schema: DealershipList, signal }),
    ...STATIC,
    retry,
  });

export const useServiceTypes = () =>
  useQuery({
    queryKey: keys.serviceTypes,
    queryFn: ({ signal }) => request(paths.serviceTypes, { schema: ServiceTypeList, signal }),
    ...STATIC,
    retry,
  });

export const useCustomer = (id: string) =>
  useQuery({
    queryKey: keys.customer(id),
    queryFn: ({ signal }) => request(paths.customer(id), { schema: Customer, signal }),
    ...STATIC,
    retry,
  });

export const useVehicles = (customerId: string) =>
  useQuery({
    queryKey: keys.vehicles(customerId),
    queryFn: ({ signal }) => request(paths.customerVehicles(customerId), { schema: VehicleList, signal }),
    ...STATIC,
    retry,
  });

// ---------- availability ----------

export const useAvailability = (dealershipId: string, query: AvailabilityQuery, enabled = true) =>
  useQuery({
    queryKey: keys.availability(dealershipId, query),
    queryFn: ({ signal }) =>
      request(paths.availability(dealershipId), { schema: AvailabilityResponse, query, signal }),
    enabled,
    retry,
  });

// ---------- appointments ----------

function invalidateBookingData(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: keys.availabilityAll }),
    qc.invalidateQueries({ queryKey: keys.appointmentsAll }),
    qc.invalidateQueries({ queryKey: keys.boardAll }),
  ]);
}

export interface CreateAppointmentVars {
  body: CreateAppointmentRequest;
  idempotencyKey?: string;
}

export function useCreateAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, idempotencyKey }: CreateAppointmentVars) =>
      request(paths.appointments, {
        method: 'POST',
        schema: AppointmentDetail,
        body,
        headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      }),
    // A 409 also means availability changed underneath the customer, so refetch on both outcomes.
    onSettled: () => invalidateBookingData(qc),
  });
}

export const useAppointments = (customerId: string, status?: AppointmentStatus) =>
  useQuery({
    queryKey: keys.appointments(customerId, status),
    queryFn: ({ signal }) =>
      request(paths.appointments, { schema: AppointmentList, query: { customerId, status }, signal }),
    retry,
  });

export const useAppointment = (reference: string) =>
  useQuery({
    queryKey: keys.appointment(reference),
    queryFn: ({ signal }) => request(paths.appointment(reference), { schema: AppointmentDetail, signal }),
    retry,
  });

export function useCancelAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reference, body }: { reference: string; body?: CancelAppointmentRequest }) =>
      request(paths.cancelAppointment(reference), {
        method: 'POST',
        schema: AppointmentDetail,
        body: body ?? {},
      }),
    onSettled: () => invalidateBookingData(qc),
  });
}

export function useRescheduleAppointment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ reference, body }: { reference: string; body: RescheduleAppointmentRequest }) =>
      request(paths.rescheduleAppointment(reference), { method: 'POST', schema: AppointmentDetail, body }),
    // A 409 also means availability changed underneath the customer, so refetch on both outcomes.
    onSettled: () => invalidateBookingData(qc),
  });
}

export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reference: string) =>
      request(paths.checkIn(reference), { method: 'POST', schema: AppointmentDetail, body: {} }),
    onSettled: () => invalidateBookingData(qc),
  });
}

// ---------- board & inventory ----------

export const useBoard = (dealershipId: string, date: string, enabled = true) =>
  useQuery({
    queryKey: keys.board(dealershipId, date),
    queryFn: ({ signal }) =>
      request(paths.board(dealershipId), { schema: BoardResponse, query: { date }, signal }),
    enabled,
    retry,
  });

export const useInventory = (dealershipId: string) =>
  useQuery({
    queryKey: keys.inventory(dealershipId),
    queryFn: ({ signal }) => request(paths.inventory(dealershipId), { schema: InventoryList, signal }),
    retry,
  });

export function useUpdateInventory(dealershipId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sku, body }: { sku: string; body: UpdateInventoryRequest }) =>
      request(paths.inventoryItem(dealershipId, sku), { method: 'PUT', schema: InventoryItem, body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.inventory(dealershipId) });
      void qc.invalidateQueries({ queryKey: keys.availabilityAll });
    },
  });
}
