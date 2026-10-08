import { randomUUID } from 'node:crypto';

export const API = (): string => process.env.E2E_API_URL!;

export interface Slot {
  startTime: string;
  endTime: string;
  status: string;
  isExpress: boolean;
}
export interface Availability {
  date: string;
  sameDay: { blocked: string | null; earliestStartTime: string } | null;
  slots: Slot[];
}

export async function availability(
  service: string,
  date: string,
  vehicleId = 'VEH-01',
  dealershipId = 'DLR-01',
): Promise<Availability> {
  const qs = new URLSearchParams({ serviceType: service, date, vehicleId });
  const res = await fetch(`${API()}/api/v1/dealerships/${dealershipId}/availability?${qs}`);
  if (!res.ok) throw new Error(`availability ${date}: ${res.status}`);
  return (await res.json()) as Availability;
}

export interface BookingInput {
  customerId: string;
  vehicleId: string;
  dealershipId?: string;
  serviceTypeCode: string;
  date: string;
  startTime: string;
}

/** POST /appointments; returns status + parsed body (never throws on 4xx). */
export async function book(input: BookingInput): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API()}/api/v1/appointments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dealershipId: 'DLR-01', bookingSessionId: randomUUID(), ...input }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Background customers CUS-10001.. own VEH-03.. (one vehicle each); these are the ICE ones. */
const BACKGROUND_ICE_VEHICLES = ['VEH-03', 'VEH-05', 'VEH-06', 'VEH-07', 'VEH-09', 'VEH-11', 'VEH-12', 'VEH-13'];
const customerOf = (vehicleId: string): string => `CUS-${10001 + Number(vehicleId.slice(4)) - 3}`;

/**
 * Books the given slot for other customers until it is no longer AVAILABLE, so a UI that loaded the grid
 * earlier will hit a 409 SLOT_UNAVAILABLE when it confirms.
 */
export async function exhaustSlot(service: string, date: string, startTime: string): Promise<number> {
  let booked = 0;
  const isOpen = async () =>
    (await availability(service, date)).slots.find((s) => s.startTime === startTime)?.status === 'AVAILABLE';
  for (const vehicleId of BACKGROUND_ICE_VEHICLES) {
    if (!(await isOpen())) return booked;
    const res = await book({
      customerId: customerOf(vehicleId),
      vehicleId,
      serviceTypeCode: service,
      date,
      startTime,
    });
    if (res.status === 201) booked += 1;
  }
  if (await isOpen()) throw new Error(`Could not exhaust ${date} ${startTime}`);
  return booked;
}
