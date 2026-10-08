import { setupServer } from 'msw/node';
import { handlers } from './handlers/index.js';

/** For vitest: `server.listen()` in a setup hook. */
export const server = setupServer(...handlers);
