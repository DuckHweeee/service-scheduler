// Injectable clock (SPEC A14). Never call `new Date()` / `Date.now()` for business decisions — use app.clock.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (iso: string): Clock => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) throw new Error(`Invalid clock instant: ${iso}`);
  return { now: () => new Date(at.getTime()) };
};

/** Mutable clock for tests that need time to move (e.g. late-arrival policy). */
export const manualClock = (iso: string) => {
  let at = new Date(iso);
  return {
    now: () => new Date(at.getTime()),
    set: (next: string) => {
      at = new Date(next);
    },
    advanceMinutes: (min: number) => {
      at = new Date(at.getTime() + min * 60_000);
    },
  };
};

/** `CLOCK_OVERRIDE=<ISO>` pins "now" for demos; otherwise the system clock. */
export const clockFromEnv = (override: string | undefined): Clock =>
  override ? fixedClock(override) : systemClock;
