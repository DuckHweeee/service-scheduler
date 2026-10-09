import { test, expect } from './support/test.js';
import { dateButton, openRecordFromConfirmation, serviceButton } from './support/ui.js';

test.describe.configure({ mode: 'serial' });

let reference = '';

test('a same-day booking appears on the board with the Express tag', async ({ page }) => {
  await page.goto('/book');
  await serviceButton(page, 'Oil and filter change').click();
  await dateButton(page, '2026-10-08').click();
  await expect(page.getByRole('button', { name: /Express slot$/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  await expect(page.getByRole('heading', { level: 1, name: /You're booked for Thursday 8 October/ })).toBeVisible();
  reference = await openRecordFromConfirmation(page);
  await expect(page.getByText('Express · same-day')).toBeVisible();

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Service board' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Service board' })).toBeVisible();
  await expect(page.getByText(/Bays and technicians for Thursday 8 October/)).toBeVisible();

  // The block is drawn on both its bay row and its technician row.
  const blocks = page.locator(`[data-reference="${reference}"]`);
  await expect(blocks).toHaveCount(2);
  await expect(blocks.first().getByText('Express')).toBeVisible();
  await expect(blocks.first().getByRole('button', { name: /^Check in / })).toBeVisible();
});

test('Check in on the board marks the appointment checked in', async ({ page }) => {
  expect(reference).toMatch(/^APT-/);
  await page.goto('/board');
  const block = page.locator(`[data-reference="${reference}"]`).first();
  await block.getByRole('button', { name: /^Check in / }).click();
  await expect(page.getByRole('status').filter({ hasText: /Checked in / })).toBeVisible();
  await expect(page.locator(`[data-reference="${reference}"]`).first().getByRole('button', { name: /^Check in / })).toHaveCount(0);

  // The record agrees.
  await block.getByRole('link').click();
  await expect(page.getByText('Checked in', { exact: true }).first()).toBeVisible();
});
