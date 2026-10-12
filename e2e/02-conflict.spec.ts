import { exhaustSlot } from './support/api.js';
import { test, expect } from './support/test.js';
import { firstOpenSlot, pickService } from './support/ui.js';

const SERVICE = 'Oil and filter change';

test('a slot taken meanwhile gives a 409 panel with alternatives; picking one confirms', async ({ page }) => {
  const { date, startTime, endTime } = await firstOpenSlot('OIL_CHANGE');

  await pickService(page, SERVICE, date);
  await expect(page.getByRole('button', { name: `${startTime} to ${endTime}, Available` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Somebody else takes the slot while this page still shows it as free.
  await exhaustSlot('OIL_CHANGE', date, startTime);

  await page.getByRole('button', { name: 'Confirm appointment' }).click();

  const panel = page.getByRole('alert').filter({ hasText: 'Someone just booked that time.' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Closest free times. Pick one:')).toBeVisible();
  const alternatives = panel.getByRole('listitem').getByRole('button');
  expect(await alternatives.count()).toBeGreaterThan(0);

  // The stale slot is now shown as unavailable.
  await expect(page.getByRole('button', { name: new RegExp(`^${startTime} to ${endTime}, (?!Available)`) })).toBeDisabled();

  const first = alternatives.first();
  const label = (await first.innerText()).trim(); // e.g. "Mon 12 Oct · 12:00–12:45"
  const altStart = /· (\d\d:\d\d)–/.exec(label)![1]!;
  await first.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: new RegExp(`^${altStart} to .*Available`) })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Confirm appointment' }).click();
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`You're booked for .*, ${altStart}`) })).toBeVisible();
});
