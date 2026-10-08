# End-to-end tests

`pnpm e2e` starts an ephemeral embedded Postgres, migrates and seeds it, starts the API (`CLOCK_OVERRIDE`
pinned to Thu 2026-10-08 09:10 local) and Vite (`VITE_USE_MOCKS=false`) on free ports, runs the specs, and tears
everything down. The browser clock is pinned to the same instant.

- Bundled Chromium: `pnpm exec playwright install chromium`, then `pnpm e2e`.
- Existing Chrome (needed on macOS 12): `PW_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm e2e`.

`05-screenshots.spec.ts` rewrites `docs/screenshots/{book,list,record,board}-{1440,390}.png`.
