import { USE_MOCKS } from '../config.js';
import { mockNowMs } from '../mocks/scenario.js';

/** Timezone used when a screen has no dealership at hand (all demo dealerships share it). */
export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/**
 * The one "now" for every decision on screen (upcoming / past, Today chip, Check in, Cancel).
 * Under MSW it follows the `?mock=` scenario clock so the screens agree with the mocked API;
 * against the real API it is the browser clock (the API's own CLOCK_OVERRIDE is not visible to the browser).
 */
export function businessNow(tz: string = DEFAULT_TZ): number {
  return USE_MOCKS ? mockNowMs(tz) : Date.now();
}
