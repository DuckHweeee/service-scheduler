// Wave 0 minimal entrypoint — A1 owns this file.
import { buildApp } from './app.js';
import { clockFromEnv } from './clock.js';
import { createDb } from './db/client.js';

const db = createDb(process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54329/scheduler');
const app = await buildApp({ db, clock: clockFromEnv(process.env.CLOCK_OVERRIDE) });
await app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' });
