// `pnpm db:seed`: truncate and rebuild reference data + deterministic background load (PRNG seed 42).
import { loadConfig } from '../src/config.js';
import { clockFromEnv } from '../src/clock.js';
import { createDb } from '../src/db/client.js';
import { mulberry32, resetDatabase, seedBackgroundLoad, seedReferenceData } from '../src/db/seed/index.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);
try {
  await resetDatabase(db);
  await seedReferenceData(db);
  console.log('reference data seeded');
  try {
    const n = await seedBackgroundLoad(db, { clock: clockFromEnv(config.CLOCK_OVERRIDE), rng: mulberry32(42) });
    console.log(`background load seeded: ${n} appointments`);
  } catch (err) {
    if (err instanceof Error && /not implemented/.test(err.message)) {
      console.warn(`background load SKIPPED: ${err.message}`);
    } else {
      throw err;
    }
  }
} finally {
  await db.$client.end();
}
