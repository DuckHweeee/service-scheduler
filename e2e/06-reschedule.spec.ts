import { test, expect } from './support/test.js';
import { dateButton, firstOpenSlot, openRecordFromConfirmation, pickService } from './support/ui.js';

const SERVICE = 'Oil and filter change';

// W5-F4: fixme until the real POST /appointments/{ref}/reschedule (W5-A8) is merged; the screen itself is covered
// on MSW by apps/web/src/screens/reschedule. Opus un-fixmes this at the A8 + F4 integration gate.
test.fixme('book, reschedule to another day from the record, see the notice and history, old slot is free again', async ({
  page,
}) => {
  const first = await firstOpenSlot('OIL_CHANGE');
  await pickService(page, SERVICE, first.date);
  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  const reference = await openRecordFromConfirmation(page);

  await page.getByRole('link', { name: 'Reschedule' }).click();
  await expect(page).toHaveURL(new RegExp(`/appointments/${reference}/reschedule`));
  await expect(page.getByRole('heading', { level: 1, name: `Reschedule ${SERVICE}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `${first.startTime} to ${first.endTime}, Current` })).toBeDisabled();

  const target = await firstOpenSlot('OIL_CHANGE', [first.date]);
  await dateButton(page, target.date).click();
  const slot = page.getByRole('button', { name: `${target.startTime} to ${target.endTime}, Available` });
  await expect(slot).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Move appointment' }).click();

  await expect(page).toHaveURL(new RegExp(`/appointments/${reference}$`));
  await expect(page.getByText(/^Appointment moved to .+ \d\d:\d\d\.$/)).toBeVisible();
  await expect(page.getByText(/Rescheduled from .+ to .+ — Bay \d, /)).toBeVisible();

  // The old slot can be booked again.
  await pickService(page, SERVICE, first.date);
  await expect(page.getByRole('button', { name: `${first.startTime} to ${first.endTime}, Available` })).toBeEnabled();
});
