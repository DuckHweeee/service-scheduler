import { test, expect } from './support/test.js';
import { dateButton, firstOpenSlot, openRecordFromConfirmation, pickService } from './support/ui.js';

const SERVICE = 'Oil and filter change';

test('book an advance appointment, open the record, cancel it and see the slot free again', async ({ page }) => {
  const { date, startTime, endTime } = await firstOpenSlot('OIL_CHANGE');
  const slot = page.getByRole('button', { name: `${startTime} to ${endTime}, Available` });

  await pickService(page, SERVICE, date);
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Same-day booking covers express maintenance only')).toHaveCount(0);

  await page.getByRole('button', { name: 'Confirm appointment' }).click();

  // Confirmation
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`You're booked for .*, ${startTime}`) })).toBeVisible();
  await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
  const reference = await openRecordFromConfirmation(page);

  // Record -> cancel
  await expect(page.getByRole('heading', { level: 1, name: SERVICE })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel appointment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByText('This appointment is cancelled.')).toBeVisible();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel appointment' })).toHaveCount(0);

  // It shows up under Cancelled in the list
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'My appointments' }).click();
  await page.getByRole('tab', { name: /Cancelled/ }).click();
  await expect(page.getByRole('link', { name: new RegExp(`${SERVICE}.*Cancelled`) })).toBeVisible();

  // The slot is bookable again on the Book screen
  await pickService(page, SERVICE, date);
  await expect(dateButton(page, date)).toHaveAttribute('aria-pressed', 'true');
  await expect(slot).toBeEnabled();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  expect(reference).toMatch(/^APT-/);
});
