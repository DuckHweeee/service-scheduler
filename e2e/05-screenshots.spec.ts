import path from 'node:path';
import type { Page } from '@playwright/test';
import { test, expect } from './support/test.js';
import { book } from './support/api.js';
import { CUSTOMER_ID } from './support/constants.js';
import { firstOpenSlot, firstSlotFreeForVehicle, pickService } from './support/ui.js';

/** Refreshes `docs/screenshots/{book,list,record,reschedule,board}-{1440,390}.png` from the real stack. */
const OUT = path.resolve(import.meta.dirname, '../docs/screenshots');
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
}

async function expectCompactHeader(page: Page, width: number) {
  const box = await page.locator('header').boundingBox();
  // Two rows at 390 px (title + avatar, then nav); a single row on desktop.
  expect(box!.height).toBeLessThanOrEqual(width <= 600 ? 112 : 80);
}

for (const viewport of VIEWPORTS) {
  test.describe(`screenshots @ ${viewport.width}`, () => {
    test.use({ viewport });

    const shoot = async (page: Page, name: string) => {
      await page.waitForLoadState('networkidle');
      await expectNoHorizontalScroll(page);
      await expectCompactHeader(page, viewport.width);
      await page.screenshot({ path: path.join(OUT, `${name}-${viewport.width}.png`), fullPage: true });
    };

    test('book', async ({ page }) => {
      const { date, startTime, endTime } = await firstOpenSlot('OIL_CHANGE');
      await pickService(page, 'Oil and filter change', date);
      await expect(page.getByRole('button', { name: `${startTime} to ${endTime}, Available` })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByText('Both resources are re-checked')).toBeVisible();
      await shoot(page, 'book');
    });

    test('list', async ({ page }) => {
      await page.goto('/appointments');
      await expect(page.getByRole('list', { name: 'Upcoming' }).getByRole('link').first()).toBeVisible();
      await shoot(page, 'list');
    });

    test('record', async ({ page }) => {
      await page.goto('/appointments');
      await page.getByRole('list', { name: 'Upcoming' }).getByRole('link').first().click();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'How it was booked' })).toBeVisible();
      await shoot(page, 'record');
    });

    test('reschedule', async ({ page }) => {
      // A fresh upcoming advance booking: earlier specs leave the first "Upcoming" row checked in (no Reschedule).
      const { date, startTime } = await firstSlotFreeForVehicle('BRAKE_PAD_REPLACEMENT');
      const res = await book({
        customerId: CUSTOMER_ID,
        vehicleId: 'VEH-01',
        serviceTypeCode: 'BRAKE_PAD_REPLACEMENT',
        date,
        startTime,
      });
      expect(res.status).toBe(201);
      await page.goto(`/appointments/${String(res.body.reference)}`);
      await page.getByRole('link', { name: 'Reschedule' }).click();
      await expect(page.getByRole('heading', { level: 1, name: /^Reschedule / })).toBeVisible();
      await expect(page.getByRole('button', { name: /, Current$/ })).toBeDisabled();
      await shoot(page, 'reschedule');
    });

    test('board', async ({ page }) => {
      await page.goto('/board');
      await expect(page.getByRole('region', { name: /Timeline/ })).toBeVisible();
      await shoot(page, 'board');
    });
  });
}
