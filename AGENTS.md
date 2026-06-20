# AGENTS.md

Guidance for coding agents working in this repository.

## What This Is

Polymarket's profile activity rebuilt as a dense internal inspection table. It is
a single-page Vite + Svelte app with no router. The app reads the wallet from the
`?address=` URL param and deliberately does not bake a default wallet into the
bundle. Production is deployed to Cloudflare Pages at https://onedam.pages.dev.

## Commands

```sh
npm run dev                    # Vite dev server on http://localhost:5173
npm run knip                   # dead-code/dependency/export scan
npm run lint                   # Oxlint JS/TS + Svelte script lint
npm run format:check           # Oxfmt formatting check
npm run format                 # Oxfmt write
npm run build                  # svelte-check + vite build
npm run test:unit              # Vitest unit contracts for modules
npm run qa:contract            # compact mocked-data browser refactor contract
npm run qa                     # desktop + mobile Playwright feature sweep
npm run qa:desktop             # desktop sweep only
npm run qa:mobile              # mobile sweep only
npm run qa:safari              # WebKit mobile layout probe for Safari-like bugs
npm run qa:error               # network-kill/error/retry probe
npm run refactor:check         # fast refactor loop gate
npm run smoke -- <url> <wallet> # production smoke probe
```

The expected fast workflow while refactoring is:

```sh
npm run refactor:check
```

Run the full `npm run qa` desktop + mobile sweep before committing UI, fetching,
filtering, or sticky-column changes. Oxlint covers Svelte `<script>` blocks, not
Svelte template linting.

Deploy:

```sh
npm run build && npx wrangler pages deploy dist --project-name onedam --branch main --commit-dirty=true
```

## Architecture

`src/api.ts` is the pure data layer. Keep it view-free. It exports activity
types, `fetchActivityPage`, event metadata fetches, pUSD balance fetching, and
`activityKey`.

The activity API caps `offset` at 3000. Pagination starts with a 50-row LCP
preview, then Load More fetches 500-row pages. After offset 3000 it restarts at
`offset=0&end=<oldest timestamp seen>`. `end` is inclusive, so duplicate
boundary rows are expected and are deduped with `activityKey`.

`src/activitySession.ts` owns activity loading state: loaded pages, cursor/dedupe
behavior, polling, loading/error flags, and retry.

`src/columnState.ts` owns visible/sticky column state: storage, invariants,
summaries, menu item state, and sticky offset derivation.

`src/categorySession.ts` owns category metadata hydration: slug/title inference,
Gamma metadata fetches, pending-slug dedupe, abort/dispose behavior, and the
event-slug category map. `src/category.ts` stays pure: category inference,
options, settled checks, and row filtering.

`src/App.svelte` owns page-level UI wiring: address validation, selected filter
values, pUSD balance display, scroll/back-to-top, and component composition.
`src/pusdBalanceSession.ts` owns pUSD balance fetch state: normalized address,
abort/stale-response handling, and fetching flags.

`src/ActivityTable.svelte` owns native table rendering, sticky/table-width DOM
measurement, loading/empty/load-more table states, and row cell rendering.
`src/ColumnConfig.svelte` owns the visible/sticky column menus and menu panel
positioning. `src/displayRow.ts` maps raw API rows into stable table display
fields.

`src/category.ts` owns category inference and category filtering helpers. The
default category is Weather. Gamma metadata is used when slug/title inference is
not enough.

`src/format.ts` owns reusable display formatting helpers.

## UI Contract

The main view is a native HTML table, not a virtualized div grid. The current
column order is:

```text
City | Temp | Date | Side | Type | Outcome | Price | Shares | Amount pUSD | Time | Tx
```

Users can choose which columns are visible and sticky. Horizontal scrolling must
stay inside `.table-container`, and sticky header/cells must remain aligned.

All filters are client-side over loaded rows. Load More expands the local row set
being filtered.

Keep these details intact unless the user explicitly changes them:

- dark, dense, terminal-inspired layout
- no top address input or Load button; the URL is the source of truth
- pUSD units, not `$`
- `CONVERSION` displays as `Convert`
- non-trade/zero prices display `--`
- time displays as short local time
- Tx renders as a `LINK` anchor to Polygonscan
- event grouping uses a deterministic accent rail, not row background fill
- `public/_headers` noindex behavior and `robots.txt` allow behavior are intentional

## QA Contract

`data-testid` attributes are the browser QA contract. Avoid renaming them unless
you update the Playwright scripts in the same change.

Important current hooks include:

```text
raw-table, raw-loading, raw-header, raw-row, cell-type, status, error, prompt,
filter-row, config-row, filter-type, filter-side, filter-outcome,
filter-category, sticky-summary, columns-summary, load-more, back-to-top,
price-sum-toggle, price-sum-bar, price-sum-equation, price-sum-clear
```
