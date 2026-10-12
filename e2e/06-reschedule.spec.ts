import { test, expect } from './support/test.js';
import { dateButton, firstSlotFreeForVehicle, openRecordFromConfirmation, pickService } from './support/ui.js';

const SERVICE = 'Oil and filter change';

// Real API (W5-A8) + reschedule screen (W5-F4); the screen's states are covered on MSW by apps/web/src/screens/reschedule.
test('book, reschedule to another day from the record, see the notice and history, old slot is free again', async ({
  page,
}) => {
  const first = await firstSlotFreeForVehicle('OIL_CHANGE');
  await pickService(page, SERVICE, first.date);
  await page.getByRole('button', { name: `${first.startTime} to ${first.endTime}, Available` }).click();
  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  const reference = await openRecordFromConfirmation(page);

  await page.getByRole('link', { name: 'Reschedule' }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${reference}/reschedule`));
  await expect(page.getByRole('heading', { level: 1, name: `Reschedule ${SERVICE}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `${first.startTime} to ${first.endTime}, Current` })).toBeDisabled();

  // Nothing is chosen for the user: the button stays disabled until they pick a time.
  await expect(page.getByRole('button', { name: 'Move appointment' })).toBeDisabled();

  const target = await firstSlotFreeForVehicle('OIL_CHANGE', [first.date]);
  await dateButton(page, target.date).click();
  const slot = page.getByRole('button', { name: `${target.startTime} to ${target.endTime}, Available` });
  await slot.click();
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Move appointment' }).click();

  await expect(page).toHaveURL(new RegExp(`/appointments/${reference}$`));
  await expect(page.getByText(/^Appointment moved to .+ \d\d:\d\d\.$/)).toBeVisible();
  await expect(page.getByText(/Rescheduled from .+ to .+ — Bay \d, /)).toBeVisible();

  // The old slot can be booked again.
  await pickService(page, SERVICE, first.date);
  await expect(page.getByRole('button', { name: `${first.startTime} to ${first.endTime}, Available` })).toBeEnabled();
});
