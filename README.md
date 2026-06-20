# Polymarket Activity Viewer

Dense internal wallet-activity table for Polymarket. The app is a single-page
Vite + Svelte application that reads the wallet from `?address=` and talks
directly to public Polymarket endpoints.

```sh
npm install
npm run dev     # http://localhost:5173
```

- **Stack:** Vite, Svelte, Tailwind v4, native HTML table.
- **Data:** `data-api.polymarket.com/activity` for activity, Gamma event
  metadata for category tags, Polygon RPC for pUSD balance.
- **Pagination:** first request loads 50 rows for faster LCP. Load More uses
  500-row pages, continues to offset 3000, then window-jumps with
  `end=<oldest timestamp seen>` and dedupes inclusive boundary rows.
- **Filters:** type and side are server-side API params. outcome and category
  filter loaded rows client-side; the default category is Weather and can
  auto-load a few more pages when the first preview has no matching rows.
- **Table:** user-configurable visible/sticky columns, horizontal scroll inside
  the table container, deterministic event accent rail, compact terminal-style
  layout.

## Commands

```sh
npm run build
npm run test:unit
npm run qa:contract
npm run qa
npm run qa:desktop
npm run qa:mobile
npm run qa:safari
npm run qa:error
npm run refactor:check
npm run smoke -- <baseUrl> <wallet>
```

`refactor:check` is the fast loop gate: build, unit module contracts, mocked
browser contract, and network-error recovery. Run full `npm run qa` before
committing UI/fetching/filter changes. Run `npm run qa:safari` for WebKit mobile
layout checks and Safari-like screenshots in `/tmp`.

Deploy:

```sh
npm run build && npx wrangler pages deploy dist --project-name onedam --branch main --commit-dirty=true
```
