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
npm run build                  # svelte-check + vite build
npm run qa                     # desktop + mobile Playwright feature sweep
npm run qa:desktop             # desktop sweep only
npm run qa:mobile              # mobile sweep only
npm run qa:error               # network-kill/error/retry probe
npm run smoke -- <url> <wallet> # production smoke probe
```

The expected workflow after feature changes is:

```sh
npm run build
npm run qa
npm run qa:error
```

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

`src/App.svelte` owns UI state and orchestration: address validation, server
filters, loaded pages, polling, sticky/visible columns, loading/error states,
and table rendering.

`src/category.ts` owns category inference and category filtering helpers. The
default category is Weather. Gamma metadata is used when slug/title inference is
not enough.

`src/format.ts` owns reusable display formatting helpers.

## UI Contract

The main view is a native HTML table, not a virtualized div grid. The current
column order is:

```text
City | Temp | Date | Side | Type | Outcome | Price | Amount pUSD | Time | Tx
```

Users can choose which columns are visible and sticky. Horizontal scrolling must
stay inside `.table-container`, and sticky header/cells must remain aligned.

Type and side filters are server-side. Outcome and category filters are
client-side over loaded rows. If the default Weather filter would otherwise show
zero rows from the first preview, the app may auto-load a small number of extra
pages before showing the empty state.

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
filter-category, sticky-summary, columns-summary, load-more, back-to-top
```
