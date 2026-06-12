# Plan: restyle to match polymarket.com — mobile-first, shadcn + Base UI

Goal: make the viewer look like the reference profile activity page (light theme),
**designed for the phone viewport first**, scaling up to desktop. Keep all data tweaks
(6 sig figs, event slug, tx links, address input, filters). Tokens and screenshots were
extracted from the live site on 2026-06-11 (`scripts/inspect-reference.mjs`,
`scripts/inspect-colors.mjs`, `scripts/inspect-mobile.mjs`; captures in
`/tmp/pm_ref_full.png`, `/tmp/pm_ref_mobile_top.png`, `/tmp/pm_ref_mobile_rows.png`).

## 0. Component stack decision: shadcn + Base UI — yes

- shadcn CLI v4 natively supports Base UI as the primitive layer:
  `npx shadcn@latest init --base base --template vite` (Radix|Base choice; full Base UI
  component docs since Jan 2026; `base-*` registry styles like `base-nova`/`base-vega`).
- Clincher: Polymarket's own `:root` uses shadcn's exact token schema (`--card`,
  `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`,
  `--border`, `--input`, `--ring`, `--radius`) — we paste their extracted values into
  shadcn's theme and every component inherits the reference look for free.
- Brings Tailwind v4 (`@tailwindcss/vite`) — also free `sm/md/lg` breakpoints for the
  mobile-first CSS.
- Components we consume: Button (Load), Input (address), Badge (outcome chip), Tabs
  (Activity bar), Card (desktop table wrapper / profile), Skeleton (loading rows),
  Sheet (optional mobile filter drawer, later).
- Keep custom: the virtualized list (shadcn Table is just styled `<table>` — we need our
  own markup, see §3) and **native `<select>` for filters on all sizes in v1** — iOS
  wheel picker beats any custom listbox for a data tool; style only the closed trigger
  as a pill. Swap to Base UI Select later if desktop polish demands it.

## 1. Design tokens → shadcn theme (`src/index.css` `@theme` / `:root`)

Typography
- `@fontsource-variable/inter`; feature settings
  `"liga" 1, "calt" 1, "cv01" 1, "cv02" 1, "cv03" 1, "cv04" 1, "cv09" 0, "cv11" 1`.
- Rows 14px (mobile titles 15px), secondary 12px, column headers 11px uppercase.

Their values (verbatim)
- shadcn vars: `--primary #111827`, `--primary-foreground #f9fafb`, `--secondary/--muted/--accent #f3f4f6`,
  `--muted-foreground #6b7280`, `--destructive #ef4444`, `--border/--input #e5e7eb`,
  `--ring #030712`, `--radius .7rem`, card/popover white on `#030712` foreground.
- Extras: text `#18181b`, faint `#a0a3b1`, secondary-text `#939aa5` (measured), page bg
  `#f4f4f6` (gray-100), hairline `#e7e8eb` (gray-200), link/brand blue `#1652f0`
  (hover `#0c3ec1`).
- Green 50→600: `#ecf9f1 #caefd8 #a8e5be #86dba5 #64d18b #42c772 #30a159`
- Red 50→600: `#fcebeb #f7c8c8 #f2a4a4 #ec8080 #e75d5d #e23939 #c61d1d`
- Yellow-500 `#f8d743` (REWARD accent, optional).

Measured chip (live row): 12px / 600, padding `2px 6px`, radius 7px;
No → `#c61d1d` on `#fcebeb`; Yes → `#30a159` on `#ecf9f1`; map Up→green, Down→red,
other outcomes gray-700 on gray-100.

## 2. Mobile anatomy first (≤ md, from /tmp/pm_ref_mobile_*.png)

Reference mobile row — **no Type column**; type folds into the sub-line:

```
[48px icon]  Will the highest temperature        $0.01
             in Ankara be 31°C on June…          7h ago ⧉
             Sell  [Yes 0¢]  6.0 shares
```

- Title wraps max 2 lines (`-webkit-line-clamp: 2`), 15px/500, links to event.
- Sub-line: `Sell · [chip w/ price-in-¢] · 6.0 shares · slug` — type 12px gray, chip as
  §1, shares/slug 12px `#939aa5` (slug is our addition, links to event; truncate).
- Right rail: `usdcSize` 6-sig 14px/600 + below it relative time ("7h ago", exact
  timestamp in tooltip) + ⧉/↗ icon → Polygonscan (reference puts the explorer link there).
- Each row = rounded-corner card (radius ~10px, bg `#f7f8f9`-ish/gray-50, ~8px gaps) —
  per reference mobile; tap target full row height ≥ 56px.
- Profile header mobile: flat (no card) — avatar 56px + name + "Joined Jan 2026";
  stats 3-up row (value 16px/600 over 12px gray label) — ours: Positions value via
  public `/value` endpoint (optional), rows loaded, oldest-activity date. PnL omitted.
- Tabs row: single active "Activity" (black text, 2px underline).
- Filters: horizontally scrollable pill row (like their category chips), sticky under
  the header; native selects styled as pills.
- Address input: full-width search pill (gray-100 bg, full radius, focus ring `--ring`);
  **min font-size 16px** to prevent iOS focus-zoom.
- Floating "Back to top ↑" pill appears after deep scroll (we have
  `virtualizer.scrollToIndex(0)` for free) — reference has it; cheap, include.
- Heights in `dvh` (iOS URL bar); overscroll fetch threshold ~900px for touch fling.

## 3. Markup change: `<table>` → div grid (keeps TanStack Table)

Per-row rounded cards can't be done sanely with `<tr>`; reference DOM is divs. Switch to
`role="table"/"row"/"cell"` divs; TanStack Table is headless so column defs +
`row.getVisibleCells()` stay; TanStack Virtual gets simpler (absolute `translateY`
items instead of the padding-spacer hack). `estimateSize`: ~88px mobile, ~64px desktop.

Columns become three composite cells: `type` (desktop only), `market`
(icon/title/sub-line), `amount` (usd/time/tx). On mobile the type cell is hidden via CSS
and re-rendered as the sub-line's first token (always rendered there).

## 4. Scale-up (`md:` and wider, from /tmp/pm_ref_full.png)

- Content column max-width ~1100px centered; page bg `#f4f4f6`; table + profile each in
  white Card (1px `#e5e7eb`, radius 12px).
- Rows lose per-card bg → white rows with `#e7e8eb` hairlines, hover `#f4f4f6`;
  Type appears as its own left column (14px, capitalized); title single-line ellipsis;
  TYPE/MARKET/AMOUNT header row 11px uppercase letterspaced `#a0a3b1`, sticky.
- Header bar: wordmark + address pill inline + blue-500 Load button.

## 5. Implementation order

1. Tailwind v4 (`@tailwindcss/vite`) + `tsconfig`/vite `@/*` alias; then
   `npx shadcn@latest init --base base` in the existing app; paste token values into the
   generated theme; `npm i @fontsource-variable/inter`.
2. `format.ts`: add `formatCents` (≤6 sig figs), `relativeTime(ts)`
   (`Intl.RelativeTimeFormat`); keep `formatUsd`/`formatNumber`.
3. Rebuild `App.tsx` view layer mobile-first per §2–§4 (api.ts untouched): div-grid
   virtual list, composite cells, header/profile/tabs/filter-pills, back-to-top.
4. Chip/Avatar as small components (shadcn Badge variant for chip; deterministic
   gradient avatar from address hash when `profileImage` is empty).
5. Desktop `md:` layer last.

## 6. QA loop (after implementing)

- Update `scripts/qa.mjs` selectors (no more `td:nth-child(n)` — use `role=row`/cell
  test-ids), then **run the full sweep twice: `devices['iPhone 14']` and 1440px**.
  All 15 checks + error-path probe green in both.
- New checks: type visible in sub-line on mobile & as column on desktop; row tap targets
  ≥ 44px; no horizontal page scroll at 390px; back-to-top works after deep scroll;
  iOS-zoom guard (16px input); side-by-side screenshot vs reference captures.
- Verify S3 market icons load from localhost (no referer block expected).

## Open choices (defaults chosen, flag if you disagree)

- Native styled `<select>` over Base UI Select in v1 (mobile UX); revisit for desktop.
- Light theme only; tokens make dark trivial later.
- Relative time in-cell, absolute in tooltip (matches reference).
- Per-row cards on mobile, flat hairline rows on desktop (both verbatim from reference).
