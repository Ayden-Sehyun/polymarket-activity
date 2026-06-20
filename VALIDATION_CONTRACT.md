# Validation Contract: Activity Table

This contract defines how a validation agent should test this app after a
refactor, framework change, or optimization pass.

## Scope

Validate the table-only Polymarket activity app.

The candidate must preserve:

- public activity source: `https://data-api.polymarket.com/activity`
- shareable wallet URL: `?address=<proxy wallet>`
- no bundled default wallet
- native table behavior with mobile horizontal scroll inside `.table-container`
- load-more pagination through the API offset cap and inclusive-boundary dedupe
- user-configurable sticky columns and visible columns
- default Weather category filter with empty-preview auto-fill behavior
- pUSD balance, polling status, error, empty, invalid-address, retry, and back-to-top states

## Required Inputs

```text
DEFAULT_WALLET=0x774728ed9264a5ca242e8bd7952a869df318fe40
OTHER_WALLET=0x0c7c5204404e9d5402d258fedac59c7212bae4cb
EMPTY_WALLET=0x0000000000000000000000000000000000000001
DESKTOP=1440x950
MOBILE=iPhone 14 / 390px viewport
```

## Mandatory Commands

Run from the project root with the dev server available at
`http://localhost:5173`:

```sh
npm run build
npm run qa
npm run qa:error
```

After production deploy:

```sh
npm run smoke -- <baseUrl> <wallet>
```

## Behavior Assertions

### URL and Address

- Bare `/` shows the prompt and makes zero activity API requests.
- `/?address=<DEFAULT_WALLET>` loads activity.
- Uppercase hex addresses still load.
- Invalid addresses show the hint and do not call the activity API.

### Data Loading

- Initial activity request uses `limit=50`, `offset=0`, and `sortDirection=DESC`.
- Load More fetches 500-row pages with increasing offsets.
- At the offset cap, the app requests `offset=3000`, then `offset=0&end=<oldest timestamp seen>`.
- Boundary duplicates from inclusive `end` are deduped.
- Polling refreshes current data without resetting loaded history or scroll.

### Filters

- Type and side filters are server-side API params.
- Outcome filter is client-side over loaded rows.
- Category filter is client-side over loaded rows, using slug/title inference and Gamma metadata.
- Default selected category is Weather.
- If the first 50-row preview has no Weather rows but later loaded rows do, the UI should auto-load a bounded number of pages instead of immediately showing `No rows.`.

### Table

Required columns, in order:

```text
City | Temp | Date | Side | Type | Outcome | Price | Amount pUSD | Time | Tx
```

Required behavior:

- Rows use `data-testid="raw-row"`.
- Header uses `data-testid="raw-header"`.
- Row height stays compact, roughly 30-36px.
- Header and body cells remain aligned while horizontally scrolling.
- Sticky columns selected by the user remain pinned with matching header/cell offsets.
- Visible-column choices hide both header and body cells and preserve at least one visible column.
- Event grouping uses a deterministic left accent rail on the first visible column.

### Formatting

- `TRADE` displays as `Trade`; `SELL` as `Sell`; `CONVERSION` as `Convert`.
- Buy/Yes and Sell/No text colors remain distinct.
- Trade prices with positive price show exactly 3 decimals.
- Non-trade or zero placeholder prices show `--`.
- `Amount pUSD` shows exactly 5 decimals, no `$`, with alignment zeroes visually muted.
- Time shows short local time only, such as `10:46 AM`.
- Tx renders a `LINK` anchor to `https://polygonscan.com/tx/<hash>`.

## Fixed Report Format

```markdown
## Validation Report

Result: PASS | FAIL
Candidate: <branch/path/url>
Validated At: <ISO timestamp>

### Commands

- `npm run build`: PASS | FAIL
- `npm run qa`: PASS | FAIL
- `npm run qa:error`: PASS | FAIL
- `npm run smoke -- ...`: PASS | FAIL | NOT_RUN

### Notes

- <short notes on bundle size, framework/runtime changes, or residual risk>

### Failures

- <file/test/behavior and concise reproduction, or "None">
```
