/* global __ENV */
// k6 load test for the booking invariants. Run with the grafana/k6 image (see loadtest/README.md); no k6 in package.json.
//
//   browse   constant arrival rate on GET availability (DLR-01/02, next working days)
//   contend  VUs each pick a random load customer, read availability, book the first AVAILABLE slot (409 is expected)
//
// Env: BASE_URL, DURATION, BROWSE_RATE, CONTEND_VUS, LT_CUSTOMERS, DAYS (how many working days compete for capacity)
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE = (__ENV.BASE_URL || 'http://host.docker.internal:3000').replace(/\/$/, '');
const API = `${BASE}/api/v1`;
const DURATION = __ENV.DURATION || '60s';
const CUSTOMERS = Number(__ENV.LT_CUSTOMERS || 200);
const DAYS = Number(__ENV.DAYS || 3);
const DEALERSHIPS = ['DLR-01', 'DLR-02'];
const SERVICES = ['OIL_CHANGE', 'GENERAL_INSPECTION', 'TIRE_ROTATION'];

// 4xx are business outcomes here, not failures: http_req_failed then counts only 5xx and network errors.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

const booked = new Counter('bookings_created_201');
const conflict = new Counter('bookings_conflict_409'); // tagged by problem code
const noSlot = new Counter('bookings_no_slot_available');
const unexpected = new Counter('unexpected_status'); // anything but 200 on availability and 201/409 on booking

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browse',
      rate: Number(__ENV.BROWSE_RATE || 20),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
    contend: {
      executor: 'constant-vus',
      exec: 'contend',
      vus: Number(__ENV.CONTEND_VUS || 20),
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    unexpected_status: ['count==0'],
    'http_req_duration{name:availability}': ['p(95)<400'],
    'http_req_duration{name:book}': ['p(95)<800'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const pad = (n) => String(n).padStart(2, '0');

/** Next `count` working days (Mon-Fri) starting tomorrow, in dealership-local time (Asia/Ho_Chi_Minh, UTC+7). */
export function setup() {
  const local = new Date(Date.now() + 7 * 3600 * 1000);
  const days = [];
  for (let i = 1; days.length < Math.max(DAYS, 5); i++) {
    const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + i));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    days.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
  }
  return { days };
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const vehicleOf = (i) => `LT-VEH-${String(i).padStart(4, '0')}`;
const customerOf = (i) => `LT-CUS-${String(i).padStart(4, '0')}`;

function availability(dealership, service, date, vehicleId) {
  const res = http.get(
    `${API}/dealerships/${dealership}/availability?serviceType=${service}&date=${date}&vehicleId=${vehicleId}`,
    { tags: { name: 'availability' } },
  );
  if (!check(res, { 'availability 200': (r) => r.status === 200 })) unexpected.add(1);
  return res;
}

export function browse(data) {
  availability(pick(DEALERSHIPS), pick(SERVICES), pick(data.days), vehicleOf(1 + Math.floor(Math.random() * CUSTOMERS)));
}

export function contend(data) {
  const n = 1 + Math.floor(Math.random() * CUSTOMERS);
  const dealership = pick(DEALERSHIPS);
  const service = pick(SERVICES);
  const days = data.days.slice(0, DAYS);

  for (const date of days) {
    const res = availability(dealership, service, date, vehicleOf(n));
    if (res.status !== 200) return;
    const slot = res.json('slots').find((s) => s.status === 'AVAILABLE');
    if (!slot) continue; // day full: try the next one

    const body = JSON.stringify({
      customerId: customerOf(n),
      vehicleId: vehicleOf(n),
      dealershipId: dealership,
      serviceTypeCode: service,
      date,
      startTime: slot.startTime,
      bookingSessionId: uuidv4(),
    });
    const book = http.post(`${API}/appointments`, body, {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'book' },
    });
    if (book.status === 201) booked.add(1);
    else if (book.status === 409) conflict.add(1, { code: book.json('code') || 'unknown' });
    else unexpected.add(1);
    check(book, { 'book 201 or 409': (r) => r.status === 201 || r.status === 409 });
    sleep(0.05);
    return;
  }
  noSlot.add(1);
  sleep(0.5);
}
