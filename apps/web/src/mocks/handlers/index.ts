import { appointmentHandlers } from './appointments.js';
import { availabilityHandlers } from './availability.js';
import { boardHandlers } from './board.js';
import { inventoryHandlers } from './inventory.js';
import { referenceHandlers } from './reference.js';

/** Every SPEC §6 endpoint. Reusable with `setupServer(...handlers)` (msw/node) in tests. */
export const handlers = [
  ...referenceHandlers,
  ...availabilityHandlers,
  ...appointmentHandlers,
  ...boardHandlers,
  ...inventoryHandlers,
];
