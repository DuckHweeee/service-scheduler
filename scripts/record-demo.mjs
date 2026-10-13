// Records the README demo GIF against a running stack (default http://localhost:5173, e.g.
// `docker compose --profile app up -d`). Books a brake job, opens the record, reschedules it, shows the history line.
// It creates a real appointment; reseed afterwards for clean data.
//
//   node scripts/record-demo.mjs [outDir]            # → <outDir>/*.webm (default: test-results/demo)
//   ffmpeg -i <webm> -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" -loop 0 docs/demo.gif
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? 'test-results/demo';
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';

const browser = await chromium.launch({ slowMo: 350 });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const scrollTo = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  await pause(500);
};
const dates = () => page.getByRole('group', { name: 'Date' }).getByRole('button');
const freeSlots = () =>
  page.getByRole('group', { name: 'Start time' }).getByRole('button', { name: /, Free$/ });

// 1) Book a brake job
await page.goto(`${WEB}/book`);
await pause(1500);
await page.getByRole('button', { name: /^Brake pad replacement/ }).click();
await scrollTo(dates().first());
await dates().nth(2).click();
await pause(800);
await freeSlots().nth(2).click();
await pause(1200);
await page.getByRole('button', { name: 'Confirm appointment' }).click();
await page.getByRole('link', { name: 'See your appointment' }).waitFor();
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await pause(2500);

// 2) Record → Reschedule to another day
await page.getByRole('link', { name: 'See your appointment' }).click();
await pause(2500);
await page.getByRole('link', { name: 'Reschedule' }).click();
await pause(1500);
await scrollTo(dates().first());
await dates().nth(3).click();
await pause(800);
await freeSlots().nth(1).click();
await pause(1200);
await page.getByRole('button', { name: 'Move appointment' }).click();

// 3) Back on the record: notice + history line
await page.getByText(/^Appointment moved to/).waitFor();
await pause(2000);
await scrollTo(page.getByText(/^Rescheduled from /));
await pause(2500);

await context.close();
await browser.close();
