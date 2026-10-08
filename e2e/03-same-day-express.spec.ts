import { test, expect } from './support/test.js';
import { dateButton, serviceButton } from './support/ui.js';

test('Today: express services show Express slots and the notice; brake pads show the not-express panel', async ({
  page,
}) => {
  await page.goto('/book');
  const today = page.getByRole('group', { name: 'Date' }).getByRole('button', { name: /^Today, Thu 8 Oct/ });
  await expect(today).toBeVisible();
  await expect(today).toContainText('SAME-DAY');

  await serviceButton(page, 'Oil and filter change').click();
  await today.click();
  await expect(today).toHaveAttribute('aria-pressed', 'true');

  await expect(
    page.getByText(
      'Same-day booking covers express maintenance only. Please arrive on time — same-day bookings are released if you are more than 15 minutes late.',
    ),
  ).toBeVisible();
  const express = page.getByRole('button', { name: /to \d\d:\d\d, Express slot$/ });
  await expect(express.first()).toBeVisible();
  // Lead time: nothing is offered before 11:30 (09:10 + 2 h).
  await expect(page.getByRole('button', { name: /^(08|09|10|11:00) to / })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm appointment' })).toBeEnabled();

  await serviceButton(page, 'Brake pad replacement').click();
  await expect(
    page.getByText(/Brake pad replacement can't be booked for today\. Same-day booking covers express services: /),
  ).toBeVisible();
  await expect(page.getByRole('group', { name: 'Start time' })).toHaveCount(0);

  // Another day brings the normal grid back and the notice goes away.
  await dateButton(page, '2026-10-12').click();
  await expect(page.getByText('Same-day booking covers express maintenance only')).toHaveCount(0);
  await expect(page.getByRole('group', { name: 'Start time' })).toBeVisible();
});
