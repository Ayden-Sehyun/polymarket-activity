# Validation Contract: Activity Table Parity

This contract defines how a validation agent must test an optimized implementation
against the current Activity Table behavior. The goal is to close the feedback
loop for bundle/network optimization work without drifting from the product
behavior that is already accepted.

## Scope

Validate the table-only Polymarket activity app.

The optimized candidate must preserve:

- Public data source: `https://data-api.polymarket.com/activity`
- Shareable wallet URL: `?address=<proxy wallet>`
- Table-only UI; no Pretty tab/view
- Mobile horizontal table scroll
- Infinite scroll through the API offset cap
- Formatting and row coloring behavior
- Error, empty, invalid-address, and retry behavior

## Required Test Inputs

Use these unless the request explicitly provides alternatives:

```text
DEFAULT_WALLET=0x774728ed9264a5ca242e8bd7952a869df318fe40
OTHER_WALLET=0x0c7c5204404e9d5402d258fedac59c7212bae4cb
EMPTY_WALLET=0x0000000000000000000000000000000000000001
```

Run against:

```text
DESKTOP=1440x950
MOBILE=iPhone 14 / 390px viewport
```

## Setup

Start the candidate app on `http://localhost:5173` unless instructed otherwise.

```sh
npm install
npm run build
npm run dev
```

If port `5173` is unavailable, use the actual dev server URL and include it in
the report.

## Mandatory Commands

From the project root:

```sh
npm run build
node scripts/qa.mjs
node scripts/qa-error.mjs
```

If validating production after deploy:

```sh
node scripts/smoke-prod.mjs <baseUrl> <wallet>
```

The validation agent may add extra probes, but these commands are mandatory.

## Behavior Assertions

The candidate must pass every item below.

### URL and Address

- Bare `/` shows the prompt and makes zero activity API requests.
- `/?address=<DEFAULT_WALLET>` pre-fills the input and loads activity.
- Loading a different wallet updates `?address=` using `replaceState` behavior.
- Uppercase hex addresses still load.
- Invalid addresses show the hint and do not call the activity API.

### Data Loading

- Initial activity request uses:
  - `user=<address>`
  - `limit=500`
  - `offset=0`
  - `sortDirection=DESC`
- Joined/profile date probe may use:
  - `limit=1`
  - `offset=0`
  - `sortDirection=ASC`
- Infinite scroll fetches additional pages with `offset += 500`.
- At the offset cap, the app must request:
  - `offset=3000`
  - then `offset=0&end=<oldest timestamp seen>`
- Boundary duplicates from inclusive `end` must be deduped.
- For `DEFAULT_WALLET`, the validation should observe more than 3500 unique
  loaded rows after deep scroll unless the upstream API data changes materially.

### Filters

- Type filter is server-side:
  - `REDEEM` request includes `type=REDEEM`
  - visible first column values are `Redeem`
  - `CONVERSION` request includes `type=CONVERSION`
  - visible first column values are `Convert`
- Side filter is server-side:
  - `SELL` request includes `side=SELL`
  - visible side values are `Sell`
- Outcome filter is client-side:
  - selecting `No` reduces visible rows below loaded rows
  - visible outcome values are `No`
  - no new server param for outcome is required

### Table Rendering

Required columns, in order:

```text
Type | Side | Title | Outcome | Price | Amount pUSD | Time | Tx
```

Required row behavior:

- Rows use `data-testid="raw-row"`.
- Header uses `data-testid="raw-header"`.
- Row height is compact, approximately 33px. A height of 30-36px passes.
- On mobile, page-level horizontal scroll is not allowed.
- On mobile, horizontal scrolling must happen inside `.table-container`.
- Header and row cells remain horizontally aligned after table scroll.
- Row background color is deterministic by `eventSlug`; same event gets same
  tint across reloads.

### Formatting

- Type and Side are capitalized, not all caps:
  - `TRADE` -> `Trade`
  - `SELL` -> `Sell`
  - `CONVERSION` -> `Convert`
- `Price`:
  - trade rows with positive price show exactly 3 decimals
  - non-trade rows or zero placeholder prices show `--`
- `Amount pUSD`:
  - shows exactly 5 decimals
  - no `$` prefix
  - trailing zeroes used only for alignment may be visually muted
- `Time`:
  - local short time with timezone is acceptable
  - fixed-width numeric alternatives are acceptable only if explicitly approved
- `Tx`:
  - opens `https://polygonscan.com/tx/<64-hex-hash>`
  - may render as an icon button

### States

- Loading state is table-shaped:
  - raw header visible
  - dense skeleton rows visible
  - no Pretty/list-card skeleton
- Empty wallet shows `No rows.` and `end of history`.
- API failure shows the error banner.
- Retry clears the banner and recovers rows.
- Back-to-top appears after deep scroll and returns the table container to top.

## Performance Checks

The validation agent must record:

- Built JS asset sizes from `npm run build`
- Built CSS asset size from `npm run build`
- Total transformed module count from Vite output
- Whether any framework/runtime was changed
- Whether the first visible rows appear before all pages are loaded

Do not fail solely on bundle size unless an explicit budget is supplied. Bundle
size is report data unless the optimization task defines a threshold.

## Allowed Implementation Changes

These are allowed if behavior remains equivalent:

- React -> Svelte, Solid, Preact, or vanilla TypeScript
- TanStack React adapters -> Svelte/Solid/core adapters
- Hand-rolled fixed-row virtualization
- Different internal state/cache/query implementation
- Different DOM structure, if test IDs and visible behavior are preserved

## Not Allowed Without Approval

- Changing activity API endpoint
- Dropping the offset-cap time-window pagination
- Changing dedupe key semantics without proof
- Hardcoding a default wallet
- Removing mobile horizontal scroll
- Changing column order or labels
- Reintroducing Pretty view/tabs
- Replacing `Amount pUSD` with `$`
- Showing `0.000` price for `CONVERSION`
- Changing SEO noindex/robots behavior

## Fixed Report Format

The validation agent must report exactly in this shape.

```markdown
## Validation Report

Result: PASS | FAIL
Candidate: <branch/path/url>
Baseline: <baseline branch/path/url or "current contract">
Validated At: <ISO timestamp>

### Commands
- `npm run build`: PASS | FAIL
- `node scripts/qa.mjs`: PASS | FAIL
- `node scripts/qa-error.mjs`: PASS | FAIL
- `node scripts/smoke-prod.mjs ...`: PASS | FAIL | NOT_RUN

### Bundle
- JS asset(s): <filename=size, ...>
- CSS asset(s): <filename=size, ...>
- Vite transformed modules: <number>
- Notes: <short notes>

### Parity Checklist
- URL/address behavior: PASS | FAIL
- Pagination/window jump/dedupe: PASS | FAIL
- Server/client filters: PASS | FAIL
- Table columns/order: PASS | FAIL
- Formatting: PASS | FAIL
- Mobile horizontal scroll: PASS | FAIL
- Loading/empty/error/retry states: PASS | FAIL
- Back-to-top: PASS | FAIL

### Failures
1. <file/feature/test>: <observed> | expected <expected>

### Evidence
- Rows loaded after deep scroll: <number>
- Offset cap request observed: YES | NO
- Window jump request observed: YES | NO
- Boundary duplicates dropped: <number or unknown>
- Mobile document scrollWidth/clientWidth: <a>/<b>
- Table scrollWidth/clientWidth: <a>/<b>
- First visible row sample: <Type | Side | Title | Outcome | Price | Amount pUSD | Time>

### Recommendation
<MERGE | DO_NOT_MERGE | NEEDS_INVESTIGATION> - <one sentence>
```

If there are no failures, write:

```text
### Failures
None.
```

## Current Known Baseline

The current accepted table behavior was last validated with:

```sh
npm run build
node scripts/qa.mjs
node scripts/qa-error.mjs
```

Expected QA result:

```text
DESKTOP: 17/17 checks passed
MOBILE: 20/20 checks passed
TOTAL: ALL GREEN
error retry probe: PASS
```

