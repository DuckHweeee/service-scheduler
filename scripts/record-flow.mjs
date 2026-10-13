// Records the full product walkthrough (≈2.5 min) against a running stack, with chapter cards and captions burned
// into the page, so it can be narrated live or watched on mute.
//
//   docker compose --profile app up --build -d --wait
//   docker compose --profile app run --rm -e SEED=always migrate     # clean data
//   node scripts/record-flow.mjs [outDir]                            # → <outDir>/*.webm
//   ffmpeg -i <webm> -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart docs/walkthrough.mp4
//
// Needs the API reachable at API_URL (default http://localhost:3000) for the "somebody else booked it" step, and
// should run before ~14:00 local so same-day slots still exist. It creates real appointments.
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

const OUT = process.argv[2] ?? 'test-results/flow';
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const API = process.env.API_URL ?? 'http://localhost:3000';

// ---- helpers: someone else takes a slot (background customers own VEH-03.. one vehicle each) ----
const BACKGROUND_ICE = ['VEH-03', 'VEH-05', 'VEH-06', 'VEH-07', 'VEH-09', 'VEH-11', 'VEH-12', 'VEH-13'];
const customerOf = (v) => `CUS-${10001 + Number(v.slice(4)) - 3}`;
async function slotStatus(service, date, startTime) {
  const qs = new URLSearchParams({ serviceType: service, date, vehicleId: 'VEH-01' });
  const r = await fetch(`${API}/api/v1/dealerships/DLR-01/availability?${qs}`);
  return (await r.json()).slots.find((s) => s.startTime === startTime)?.status;
}
async function takeSlot(service, date, startTime) {
  for (const vehicleId of BACKGROUND_ICE) {
    if ((await slotStatus(service, date, startTime)) !== 'AVAILABLE') return;
    await fetch(`${API}/api/v1/appointments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        customerId: customerOf(vehicleId),
        vehicleId,
        dealershipId: 'DLR-01',
        serviceTypeCode: service,
        date,
        startTime,
        bookingSessionId: randomUUID(),
      }),
    });
  }
}

// ---- recording setup ----
const browser = await chromium.launch({ slowMo: 300 });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
const pause = (ms) => page.waitForTimeout(ms);

// Overlay: a caption bar and a full-screen chapter card, re-created after full page loads.
await page.addInitScript(() => {
  const css = `
    #__cap{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:1000px;z-index:99999;
      background:rgba(21,23,26,.92);color:#fff;font:600 20px/1.35 system-ui,sans-serif;padding:12px 22px;
      border-radius:4px;text-align:center;pointer-events:none;opacity:0;transition:opacity .25s}
    #__card{position:fixed;inset:0;z-index:100000;background:#15171A;color:#fff;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:14px;font-family:system-ui,sans-serif;opacity:0;
      transition:opacity .3s;pointer-events:none}
    #__card b{font-size:46px;letter-spacing:.01em} #__card span{font-size:24px;color:#9DB4FF;max-width:900px;text-align:center}`;
  const ensure = () => {
    if (document.getElementById('__cap')) return;
    const s = document.createElement('style');
    s.textContent = css;
    document.documentElement.append(s);
    for (const id of ['__cap', '__card']) {
      const d = document.createElement('div');
      d.id = id;
      document.documentElement.append(d);
    }
  };
  window.__say = (t) => {
    ensure();
    const el = document.getElementById('__cap');
    el.textContent = t ?? '';
    el.style.opacity = t ? '1' : '0';
  };
  window.__card = (title, sub) => {
    ensure();
    const el = document.getElementById('__card');
    el.replaceChildren();
    if (title) {
      const b = document.createElement('b');
      b.textContent = title;
      const s = document.createElement('span');
      s.textContent = sub ?? '';
      el.append(b, s);
    }
    el.style.opacity = title ? '1' : '0';
  };
});
const say = async (text, ms = 2200) => {
  await page.evaluate((t) => window.__say?.(t), text);
  if (ms) await pause(ms);
};
const chapter = async (n, title, sub) => {
  await say('', 0);
  await page.evaluate(([t, s]) => window.__card?.(t, s), [`${n}. ${title}`, sub]);
  await pause(2600);
  await page.evaluate(() => window.__card?.(''));
  await pause(400);
};
const go = async (path) => {
  await page.goto(`${WEB}${path}`);
  await pause(1200);
};
const dates = () => page.getByRole('group', { name: 'Date' }).getByRole('button');
const slots = (label) => page.getByRole('group', { name: 'Start time' }).getByRole('button', { name: label });
const scrollTo = async (loc) => {
  await loc.scrollIntoViewIfNeeded();
  await pause(500);
};

// ===== 0. Intro =====
await go('/book');
await chapter(
  '',
  'Unified Service Scheduler',
  'Book, change and run service appointments — a bay and a technician, guaranteed.',
);

// ===== 1. Book =====
await chapter(1, 'Book a service', 'Pick your vehicle, the service, a dealership and a time.');
await say('Choose the vehicle and the service. Express jobs carry an "Express" tag.');
await page.getByRole('button', { name: /^Brake pad replacement/ }).click();
await pause(800);
await say('Pick a day. Slots that cannot be covered are greyed out, with the reason.');
await scrollTo(dates().first());
await dates().nth(2).click();
await pause(1200);
await say('The first free time is already chosen. On the right: the bay and technician we will reserve.');
await slots(/, Free$/)
  .nth(2)
  .click();
await pause(2500);
await say('Confirm — both are checked again and reserved together.', 1200);
await page.getByRole('button', { name: 'Confirm appointment' }).click();
await page.getByRole('link', { name: 'See your appointment' }).waitFor();
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
await say('Booked. You get a booking number and the exact bay and technician.', 3000);

// ===== 2. Record =====
await chapter(2, 'Your appointment', 'Everything about it on one page — and how it was booked.');
await page.getByRole('link', { name: 'See your appointment' }).click();
await pause(1500);
await say('Who and what is involved: customer, vehicle, technician, service bay.', 3000);
const how = page.getByRole('heading', { name: 'How it was booked' });
await scrollTo(how);
await say('"How it was booked" is the audit trail: every check, in order.', 3500);
const brakeRecord = page.url();

// ===== 3. Conflict =====
await chapter(3, 'When the time is taken', 'Someone books the same slot a moment before you do.');
await go('/book');
await page.getByRole('button', { name: /^Oil and filter change/ }).click();
await scrollTo(dates().first());
await dates().nth(1).click();
await pause(1000);
const chosen = slots(/, Free$/).nth(1);
const label = await chosen.getAttribute('aria-label'); // "10:00 to 10:45, Free"
const startTime = /^(\d\d:\d\d)/.exec(label)[1];
const dateText = await dates().nth(1).innerText();
await chosen.click();
await say(`You pick ${startTime}…`, 1800);
// resolve the ISO date of the pressed date button from the availability call the page made
const isoDate = await page.evaluate(() => {
  const p = performance
    .getEntriesByType('resource')
    .filter((e) => e.name.includes('/availability?'))
    .pop();
  return new URL(p.name).searchParams.get('date');
});
await takeSlot('OIL_CHANGE', isoDate, startTime);
await say('…but somebody else just booked it.', 1600);
await page.getByRole('button', { name: 'Confirm appointment' }).click();
const panel = page.getByRole('alert').filter({ hasText: 'Someone just booked that time.' });
await panel.waitFor();
await scrollTo(panel);
await say('No error code, no dead end: the closest free times are offered right away.', 3200);
await panel.getByRole('listitem').getByRole('button').first().click();
await pause(1500);
await say('Nothing is chosen for you. Pick one of the alternatives, then confirm.', 2200);
await page.getByRole('button', { name: 'Confirm appointment' }).click();
await page.getByRole('link', { name: 'See your appointment' }).waitFor();
await say('Booked — no double booking, even when two people race for one slot.', 3000);
void dateText;

// ===== 4. Reschedule =====
await chapter(4, 'Change your mind', 'Move an appointment — same booking number, history kept.');
await page.goto(brakeRecord);
await pause(1500);
await page.getByRole('link', { name: 'Reschedule' }).click();
await pause(1500);
await say('Your vehicle, service and dealership stay the same. Your current time is marked.', 3000);
await say('Nothing is pre-selected, so you cannot move it by accident.', 2500);
await scrollTo(dates().first());
await dates().nth(3).click();
await pause(1200);
await slots(/, Free$/)
  .nth(1)
  .click();
await pause(1800);
await say('Move it — the new time is checked and reserved before the old one is released.', 1500);
await page.getByRole('button', { name: 'Move appointment' }).click();
await page.getByText(/^Appointment moved to/).waitFor();
await say('Done. Same booking number; the history shows the move.', 2000);
await scrollTo(page.getByText(/^Rescheduled from /));
await say('"Rescheduled from … to …" is added to the audit trail.', 3000);

// ===== 5. Same-day express =====
await chapter(5, 'Need it today?', 'Same-day "Express" booking for quick jobs, with clear rules.');
await go('/book');
await page.getByRole('button', { name: /^Oil and filter change/ }).click();
await scrollTo(dates().first());
await dates().first().click(); // Today
await pause(1500);
await say('Today is marked SAME-DAY. Express slots start two hours from now.', 3200);
await say('Same-day is for express jobs only — and a late customer loses the slot after 15 minutes.', 3600);
await page.getByRole('button', { name: /^Brake pad replacement/ }).click();
await pause(1500);
await say('A longer job like brake pads cannot be booked for today. We say so — and what to do.', 3600);
await page.getByRole('button', { name: /^Oil and filter change/ }).click();
await pause(1200);
await scrollTo(slots(/, Express$/).first());
await slots(/, Express$/)
  .nth(1)
  .click();
await pause(1500);
await page.getByRole('button', { name: 'Confirm appointment' }).click();
await page.getByRole('link', { name: 'See your appointment' }).waitFor();
await say(
  'Booked for today. The parts are reserved too, so the job cannot be blocked by missing stock.',
  3600,
);
await page.getByRole('link', { name: 'See your appointment' }).click();
await pause(1200);
const expressRef = new URL(page.url()).pathname.split('/').pop();

// ===== 6. Service board =====
await chapter(6, 'The service advisor’s view', 'Every bay and every technician, hour by hour.');
await go('/board');
await say('Each row is a bay or a technician. Express jobs are tagged.', 3000);
const block = page.locator(`[data-reference="${expressRef}"]`).first();
await scrollTo(block);
await say('The customer arrives: the advisor taps "Check in".', 2200);
await block.getByRole('button', { name: /^Check in / }).click();
await page
  .getByRole('status')
  .filter({ hasText: /Checked in / })
  .waitFor();
await say('Checked in. Late same-day customers are released automatically for the next person.', 3600);

// ===== 7. Cancel =====
await chapter(7, 'Cancelling', 'Free the time for someone else, in one step.');
await go('/appointments');
await say('"My appointments": upcoming, past, and cancelled or missed.', 3000);
// The checked-in express job is first in the list and can no longer be cancelled: open the rescheduled brake job.
await page
  .getByRole('list', { name: 'Upcoming' })
  .getByRole('link', { name: /Brake pad replacement/ })
  .first()
  .click();
await pause(1500);
await page.getByRole('button', { name: 'Cancel appointment' }).click();
await say('A clear confirmation — it says what will happen.', 2800);
await page.getByRole('dialog').getByRole('button', { name: 'Yes, cancel it' }).click();
await page.getByText('This appointment is cancelled.').waitFor();
await say('Cancelled. Its time is free again for other customers.', 3200);

await chapter(
  '',
  'That is the whole flow',
  'Book · Conflict-safe · Reschedule · Same-day Express · Service board · Cancel',
);

await context.close();
await browser.close();
