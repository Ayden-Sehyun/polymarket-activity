# Polymarket activity viewer

Polymarket's profile activity tab without the sign-in wall — talks straight to the
public `data-api.polymarket.com/activity` endpoint (CORS is `*`, no auth).

```sh
npm install
npm run dev     # http://localhost:5173
```

- **Stack:** Vite + React, TanStack Query (infinite pagination), TanStack Table, TanStack Virtual.
- **Pagination:** the API caps `offset` at 3000; when the app hits the cap it restarts at
  `offset=0` with `end=<oldest timestamp seen>` and dedupes the inclusive boundary rows,
  so scrolling reaches the full history.
- **Filters:** type (trade/redeem/convert/split/merge/reward) and side (buy/sell) are
  API params; outcome (Yes/No/Up/Down/…) is filtered client-side over loaded rows.
- **Numbers** are formatted to 6 significant figures; tx links go to Polygonscan,
  market/slug links to polymarket.com.
- **QA:** with the dev server running — `node scripts/qa.mjs` (full feature sweep in
  headless Chromium) and `node scripts/qa-error.mjs` (network-failure + retry probe).
