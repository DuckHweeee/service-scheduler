import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { availability, vehicleBusy } from './api.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Next five working days after the pinned "today" (what the Book date strip shows after Today). */
export const ADVANCE_DATES = ['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15'];

/** `2026-10-12` → `Mon 12 Oct` (the date-strip button label). */
export function dateShort(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WD[wd]} ${d} ${MON[m - 1]}`;
}

/** First (date, slot) with an AVAILABLE slot for an advance booking of `service`, skipping given dates. */
export async function firstOpenSlot(service: string, skip: string[] = []) {
  for (const date of ADVANCE_DATES) {
    if (skip.includes(date)) continue;
    const a = await availability(service, date);
    const slot = a.slots.find((s) => s.status === 'AVAILABLE');
    if (slot) return { date, startTime: slot.startTime, endTime: slot.endTime };
  }
  throw new Error(`No open slot for ${service}`);
}

/**
 * Like `firstOpenSlot`, but also free for VEH-01 itself. The grid is not vehicle-aware (README limitation) and earlier
 * specs leave VEH-01 bookings behind, so the first AVAILABLE slot may answer 409 VEHICLE_ALREADY_BOOKED. Callers must
 * click the returned slot explicitly (the Book screen auto-selects the first AVAILABLE one).
 */
export async function firstSlotFreeForVehicle(service: string, skip: string[] = []) {
  const busy = await vehicleBusy('VEH-01');
  for (const date of ADVANCE_DATES) {
    if (skip.includes(date)) continue;
    const a = await availability(service, date);
    const slot = a.slots.find(
      (s) => s.status === 'AVAILABLE' && !busy.some((b) => b.date === date && b.start < s.endTime && s.startTime < b.end),
    );
    if (slot) return { date, startTime: slot.startTime, endTime: slot.endTime };
  }
  throw new Error(`No slot free for VEH-01 for ${service}`);
}

export const dateButton = (page: Page, date: string) =>
  page.getByRole('group', { name: 'Date' }).getByRole('button', { name: new RegExp(dateShort(date)) });

export const serviceButton = (page: Page, name: string) =>
  page.getByRole('button', { name: new RegExp(`^${name}`) });

/** Opens /book and picks the service and date. */
export async function pickService(page: Page, serviceName: string, date: string): Promise<void> {
  await page.goto('/book');
  await serviceButton(page, serviceName).click();
  await dateButton(page, date).click();
  await expect(dateButton(page, date)).toHaveAttribute('aria-pressed', 'true');
}

/** Follows "See your appointment" from the confirmation panel and returns the reference. */
export async function openRecordFromConfirmation(page: Page): Promise<string> {
  await page.getByRole('link', { name: 'See your appointment' }).click();
  await expect(page).toHaveURL(/\/appointments\/APT-/);
  return new URL(page.url()).pathname.split('/').pop()!;
}
