# Brief W3-F3 — Web on the real API, mobile polish, end-to-end tests

You are a Sonnet agent implementing **one work package**. Read `CLAUDE.md`, `docs/SPEC.md` §6 and §8, the existing web app
(`apps/web/**`), the API entrypoints (`apps/api/src/{app,server}.ts`, `apps/api/scripts/*`, `apps/api/src/db/embedded.ts`) and
`docs/screenshots/*.png`. Run `pnpm install` first.

## You own
- `apps/web/**` (fixes and polish only — no redesigns)
- `e2e/**` (new), root `playwright.config.ts` (new), root `package.json` **scripts only** (add `e2e`)
- `@playwright/test` as a root devDependency (allowed)

## Deliverables
1. **Real API mode** (`VITE_USE_MOCKS=false`): everything works against the API on `VITE_API_URL`. Check CORS, loading and error
   states on every screen (API down → readable error panel with retry, not a blank page), and that nothing relies on mock-only
   behaviour (e.g. the mock demo seed, `?mock=` params). Board "today" and Book "today" should come from the dealership timezone;
   when the API runs with `CLOCK_OVERRIDE`, the web must still agree on which day is "today" — expose the server's notion of
   today via the existing data if possible (e.g. availability `sameDay`), otherwise document the limitation.
2. **Mobile polish at 390 px:** header (currently wraps to four rows) → compact layout (e.g. title + nav on one scrollable row,
   user chip hidden or icon-only); board day-nav buttons on one row; board row-header column narrower on small screens. Keep
   1440 px unchanged.
3. **E2E (Playwright)**, `pnpm e2e` from the repo root:
   - Global setup starts an **ephemeral embedded Postgres** (reuse `startEmbedded`/`migrate`/seed code from `apps/api`, do not
     duplicate it), migrates + seeds, starts the API with `CLOCK_OVERRIDE` pinned to a fixed weekday morning (so same-day
     scenarios are deterministic) and the web with `VITE_USE_MOCKS=false`; tears everything down.
   - Browser: use Playwright's bundled Chromium by default; if `PW_CHROME_PATH` is set, launch that executable instead
     (needed on this macOS 12 dev machine: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`). Document both.
   - Specs: (1) book an advance appointment → confirmation → open record → cancel → record shows Cancelled and the slot is
     available again on the Book screen; (2) conflict: book a slot via the API first, then try the same slot in the UI → 409 panel
     with alternatives → pick one → confirmed; (3) same-day express: Today + oil change shows Express slots and the notice,
     brake shows the not-express panel; (4) board shows the new appointment and Check in works.
   - Screenshots of the four main screens at 1440 and 390 px saved to `docs/screenshots/` by a dedicated spec (overwrite the
     existing files) so docs stay current.

## Acceptance criteria
- [ ] `pnpm e2e` green locally with `PW_CHROME_PATH` set; report the run output.
- [ ] `pnpm dev` with `VITE_USE_MOCKS=false` + a running API: manual smoke of all four screens described in the report.
- [ ] 390 px: no page-level horizontal scroll on any screen; header ≤ 2 rows (screenshot evidence).
- [ ] Existing unit/component tests still green; `pnpm verify` green **and exit code 0** (check `$?`).

Finish with the report format from `CLAUDE.md` and commit on your worktree branch.
