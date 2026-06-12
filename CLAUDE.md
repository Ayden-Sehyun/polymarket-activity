# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Polymarket's profile activity tab rebuilt without the sign-in wall, talking directly to the public `data-api.polymarket.com/activity` endpoint (CORS `*`, no auth). Single-page Vite + React 19 app, no router. Deployed to Cloudflare Pages at https://onedam.pages.dev.

## Commands

```sh
npm run dev                    # Vite dev server on http://localhost:5173
npm run build                  # tsc (typecheck) + vite build → dist/
```

There are no unit tests. The test suite is browser-level QA driven by Playwright against the **running dev server** — start `npm run dev` first:

```sh
node scripts/qa.mjs            # full feature sweep, desktop (1440x950) AND mobile (iPhone 14)
node scripts/qa.mjs mobile     # one viewport only (or `desktop`)
node scripts/qa-error.mjs      # network-kill → error banner → retry recovery probe
node scripts/smoke-prod.mjs [baseUrl] [wallet]   # smoke test the live deployment
```

The expected workflow after any feature change: run `qa.mjs` (both viewports) and `qa-error.mjs` in a loop until all green. Playwright scripts must live in `scripts/` — they can't resolve the `playwright` package from outside the project dir.

Deploy (requires `wrangler login`):

```sh
npm run build && npx wrangler pages deploy dist --project-name onedam --branch main --commit-dirty=true
```

## Architecture

**`src/api.ts` is the pure data layer — keep it view-free.** It exports the `Activity` types, `fetchActivityPage`, and `activityKey`. The pagination cursor design is the heart of the app: the API caps `offset` at 3000, so the cursor pages `offset += 500` until the cap, then window-jumps to `{offset: 0, end: <oldest timestamp seen>}`. `end` is *inclusive*, so duplicate boundary rows are expected by design; `App.tsx` dedupes with the composite `activityKey` (txHash|type|asset|side|outcomeIndex|size|timestamp), which is also the table's `getRowId`/React key. `qa.mjs` verifies this at the network level (asserts an `offset=3000` request followed by `offset=0&end=…`).

**`src/App.tsx`** holds all state. `useInfiniteQuery` keyed on `[activity, address, type, side]` — type and side are server params; the outcome filter (Yes/No/…) is client-side over loaded rows. The wallet address lives in the `?address=` URL param (read on mount, written via `replaceState` on Load) so links are shareable. **There is deliberately no default wallet baked into the bundle** — the owner wants their address private; never hardcode one.

**The list is a div-grid, not a `<table>`.** Headless TanStack Table provides three display columns (type/market/amount) rendered as `role="table"/"row"/"cell"` divs positioned by TanStack Virtual (absolute + translateY). This is what lets mobile and desktop have different anatomy from one DOM: on mobile the Type column is hidden and the type token folds into the market sub-line; rows are rounded cards. Mobile-first throughout.

**Styling** is Tailwind v4 (via `@tailwindcss/vite`) + shadcn components on Base UI primitives (`src/components/ui/`). All design tokens in `src/index.css` were measured off polymarket.com (shadcn's CSS-var schema plus `--page`/`--brand`/`--hairline`/`--faint`/`--secondary-text` extras and green/red 50–600 scales) — `PLAN-styling.md` is the spec they came from. Filter dropdowns are native `<select>`s styled as pills (`.pill-select`) on purpose: it keeps the iOS wheel picker. The address input is 16px to prevent iOS focus-zoom.

**Number formatting contract** (`src/format.ts`, enforced by `qa.mjs`): USD and share counts cap at 6 significant digits; the outcome-chip price shows the API's full precision at ≤15 significant digits with a minimum of 2 decimals (`0.999` → `99.90¢`, `0.5` → `50.00¢`) — 15 rather than 17 because the dollars→cents `×100` injects float dust at digit 16 (`99.9`, not `99.89999999999999`).

**`data-testid` attributes are the QA contract** (`row`, `cell-type`, `subline-type`, `chip`, `status`, `error`, `prompt`, `address-input`, `back-to-top`, …). Keep them intact when refactoring or the sweeps break.

**SEO is intentionally hostile:** `public/_headers` sets `X-Robots-Tag: noindex` on everything, mirrored by a meta tag. `public/robots.txt` deliberately *allows* crawling — blocking it would stop crawlers from ever seeing the noindex and a linked URL could still be listed bare. Don't "fix" it to `Disallow: /`.

## TypeScript 6 quirks already handled

- `"types": ["vite/client"]` in tsconfig is required for the side-effect CSS import (TS2882 without it).
- `baseUrl` is removed (TS6 hard-errors with TS5101); the `@/*` alias works via `paths` alone, mirrored in `vite.config.ts`.
