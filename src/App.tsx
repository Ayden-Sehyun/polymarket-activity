import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowUp, ExternalLink } from 'lucide-react'
import {
  activityKey,
  fetchActivityPage,
  type Activity,
  type ActivityType,
  type Cursor,
  type Side,
} from './api'
import {
  formatMonthYear,
  formatNumber,
  formatTimeShort,
  formatTimeExact,
  formatUsd,
  relativeTime,
  shortHash,
} from './format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { OutcomeChip } from '@/components/OutcomeChip'
import { ProfileAvatar } from '@/components/ProfileAvatar'
import { MarketIcon } from '@/components/MarketIcon'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

/** Shareable links: the loaded wallet lives in ?address=… (no baked-in default). */
const addressFromUrl = () =>
  new URLSearchParams(window.location.search).get('address')?.trim() ?? ''
const writeAddressToUrl = (address: string) => {
  const url = new URL(window.location.href)
  if (address) url.searchParams.set('address', address)
  else url.searchParams.delete('address')
  history.replaceState(null, '', url)
}

const TYPE_OPTIONS: { value: ActivityType | ''; label: string }[] = [
  { value: '', label: 'All types' },
  { value: 'TRADE', label: 'Trade' },
  { value: 'REDEEM', label: 'Redeem' },
  { value: 'CONVERSION', label: 'Convert' },
  { value: 'SPLIT', label: 'Split' },
  { value: 'MERGE', label: 'Merge' },
  { value: 'REWARD', label: 'Reward' },
]

const eventHref = (slug: string) => `https://polymarket.com/event/${slug}`
const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`

const columnHelper = createColumnHelper<Activity>()
// Headless TanStack Table: three composite columns rendered as div cells.
const columns = [
  columnHelper.display({ id: 'type' }),
  columnHelper.display({ id: 'market' }),
  columnHelper.display({ id: 'amount' }),
]

const rawEventTint = (eventSlug: string) => {
  let hash = 0
  for (let i = 0; i < eventSlug.length; i += 1) {
    hash = (hash * 31 + eventSlug.charCodeAt(i)) >>> 0
  }
  return `hsl(${hash % 360} 72% 92% / 0.78)`
}

const rawColumns = [
  columnHelper.accessor('type', {
    header: 'Type',
    cell: (info) => (info.getValue() === 'CONVERSION' ? 'Convert' : capitalize(info.getValue())),
  }),
  columnHelper.accessor('side', {
    header: 'Side',
    cell: (info) => capitalize(info.getValue()),
  }),
  columnHelper.accessor('title', { header: 'Title' }),
  columnHelper.accessor('outcome', { header: 'Outcome' }),
  columnHelper.accessor('price', {
    header: 'Price',
    cell: (info) =>
      info.row.original.type === 'TRADE' && info.getValue() > 0
        ? <DecimalNumber value={info.getValue()} decimals={3} />
        : <span className="text-[var(--faint)]">--</span>,
  }),
  columnHelper.accessor('usdcSize', {
    header: 'Amount pUSD',
    cell: (info) => <DecimalNumber value={info.getValue()} decimals={5} />,
  }),
  columnHelper.accessor('timestamp', {
    header: 'Time',
    cell: (info) => formatTimeShort(info.getValue()),
  }),
  columnHelper.display({
    id: 'tx',
    header: 'Tx',
    cell: ({ row }) => (
      <a
        href={txHref(row.original.transactionHash)}
        target="_blank"
        rel="noreferrer"
        title={row.original.transactionHash}
        className="inline-flex size-6 items-center justify-center rounded-full text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
      >
        <ExternalLink className="size-3" />
        <span className="sr-only">Open transaction on Polygonscan</span>
      </a>
    ),
  }),
]

const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)

/** One extra fetch for the oldest activity row → "Joined <Mon YYYY>". */
async function fetchOldestActivity(address: string, signal?: AbortSignal): Promise<Activity | null> {
  const params = new URLSearchParams({
    user: address,
    limit: '1',
    offset: '0',
    sortDirection: 'ASC',
  })
  const res = await fetch(`https://data-api.polymarket.com/activity?${params}`, { signal })
  if (!res.ok) throw new Error(`data-api ${res.status}`)
  const items = (await res.json()) as Activity[]
  return items[0] ?? null
}

export default function App() {
  const [addressInput, setAddressInput] = useState(addressFromUrl)
  const [address, setAddress] = useState(addressFromUrl)
  const [type, setType] = useState<ActivityType | ''>('')
  const [side, setSide] = useState<Side | ''>('')
  const [outcome, setOutcome] = useState('')
  const [view, setView] = useState<'activity' | 'raw'>('raw')
  const [showTop, setShowTop] = useState(false)

  const validAddress = ADDRESS_RE.test(address)

  const {
    data,
    error,
    isError,
    isPending,
    isFetching,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['activity', address.toLowerCase(), type, side],
    queryFn: ({ pageParam, signal }) => fetchActivityPage(address, { type, side }, pageParam, signal),
    initialPageParam: { offset: 0 } as Cursor,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: validAddress,
  })

  const joinedQuery = useQuery({
    queryKey: ['joined', address.toLowerCase()],
    queryFn: ({ signal }) => fetchOldestActivity(address, signal),
    enabled: validAddress,
    staleTime: 5 * 60_000,
  })

  const allRows = useMemo(() => {
    const seen = new Set<string>()
    const out: Activity[] = []
    for (const page of data?.pages ?? []) {
      for (const item of page.items) {
        const key = activityKey(item)
        if (!seen.has(key)) {
          seen.add(key)
          out.push(item)
        }
      }
    }
    return out
  }, [data])

  const outcomes = useMemo(() => {
    const set = new Set<string>()
    for (const row of allRows) if (row.outcome) set.add(row.outcome)
    return [...set].sort()
  }, [allRows])

  const rows = useMemo(
    () => (outcome ? allRows.filter((row) => row.outcome === outcome) : allRows),
    [allRows, outcome],
  )

  // Profile fields derived from loaded rows (display name + avatar).
  const profile = useMemo(() => {
    const first = allRows[0]
    const named = allRows.find((r) => r.name || r.pseudonym)
    return {
      name: named?.name || named?.pseudonym || 'Anonymous',
      // profileImage is in the payload but not in our Activity type (often ""):
      // read via cast; ProfileAvatar falls back to a gradient when empty.
      image: (first as unknown as { profileImage?: string })?.profileImage,
    }
  }, [allRows])

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: activityKey,
  })
  const rawTable = useReactTable({
    data: rows,
    columns: rawColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: activityKey,
  })
  const tableRows = table.getRowModel().rows
  const rawTableRows = rawTable.getRowModel().rows
  const activeRows = view === 'raw' ? rawTableRows : tableRows

  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: activeRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (view === 'raw' ? 33 : 88),
    overscan: 12,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  const maybeFetchMore = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    setShowTop(el.scrollTop > 1200)
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 900
    if (nearBottom && hasNextPage && !isFetchingNextPage && !isError) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage])

  // keep loading while the (possibly client-filtered) view doesn't fill the viewport
  useEffect(() => {
    maybeFetchMore()
  }, [maybeFetchMore, rows.length])

  // when the dataset changes (address / filters), jump the list back to the top so
  // a previously deep scroll position doesn't leave the new (shorter) list off-screen
  useEffect(() => {
    const el = parentRef.current
    if (el) el.scrollTop = 0
    setShowTop(false)
  }, [address, type, side, outcome, view])

  const statusTail = isFetching
    ? ' · fetching…'
    : hasNextPage
      ? ' · scroll for more'
      : validAddress
        ? ' · end of history'
        : ''
  const statusText =
    rows.length === allRows.length
      ? `${allRows.length} rows`
      : `${rows.length} of ${allRows.length} loaded rows`

  const loading = isPending && validAddress
  const empty = !loading && tableRows.length === 0

  return (
    <div className="min-h-[100dvh] bg-[var(--page)] text-foreground">
      {/* ---- Header ---- */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-[var(--page)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--page)]/75">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-4 md:py-3.5">
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-[var(--brand)] text-base font-bold text-white">
              P
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Activity</span>
          </div>
          <form
            className="flex flex-1 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const next = addressInput.trim()
              setAddress(next)
              writeAddressToUrl(next)
            }}
          >
            <Input
              value={addressInput}
              onChange={(e) => setAddressInput(e.target.value)}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="0x… proxy wallet address"
              data-testid="address-input"
              className="h-10 flex-1 rounded-full bg-secondary text-base md:h-9 md:max-w-[460px]"
            />
            <Button type="submit" className="h-10 rounded-full bg-[var(--brand)] px-5 text-white hover:bg-[var(--brand-hover)] md:h-9">
              Load
            </Button>
          </form>
        </div>
        {address !== '' && !validAddress && (
          <div className="mx-auto max-w-[1100px] px-4 pb-2 text-xs text-destructive" data-testid="hint">
            <span className="hint">enter a 0x… address (40 hex chars)</span>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1100px] px-4 pb-24 pt-4 md:pt-6">
        {/* ---- Profile strip (flat on mobile, card on desktop) ---- */}
        {validAddress && (
        <Card className="mb-4 flex-row items-center gap-3 rounded-none border-0 bg-transparent px-0 py-0 shadow-none ring-0 md:gap-4 md:rounded-xl md:bg-card md:px-5 md:py-4 md:ring-1">
          <ProfileAvatar
            address={address}
            src={profile.image}
            className="size-14 md:size-16"
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-semibold leading-tight md:text-xl" data-testid="profile-name">
              {profile.name}
            </div>
            <div className="truncate font-mono text-xs text-muted-foreground md:text-sm">
              {validAddress ? shortHash(address) : '—'}
            </div>
            <div className="mt-0.5 text-xs text-[var(--secondary-text)]" data-testid="profile-joined">
              {joinedQuery.data
                ? `Joined ${formatMonthYear(joinedQuery.data.timestamp)}`
                : joinedQuery.isFetching
                  ? 'Joined …'
                  : ' '}
            </div>
          </div>
        </Card>
        )}

        {/* ---- Tabs ---- */}
        <Tabs value={view} onValueChange={(v) => setView(v as 'activity' | 'raw')} className="mb-2">
          <TabsList variant="line" className="border-b border-hairline">
            <TabsTrigger value="activity" className="px-0 pb-2 text-[15px]">
              Pretty
            </TabsTrigger>
            <TabsTrigger value="raw" className="px-0 pb-2 text-[15px]" data-testid="tab-raw">
              Table
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* ---- Filter pills (sticky, horizontally scrollable) ---- */}
        <div className="sticky top-[57px] z-20 -mx-4 mb-3 flex gap-2 overflow-x-auto bg-[var(--page)] px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:top-[61px]">
          <PillSelect
            value={type}
            onChange={(v) => setType(v as ActivityType | '')}
            data-testid="filter-type"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </PillSelect>
          <PillSelect value={side} onChange={(v) => setSide(v as Side | '')} data-testid="filter-side">
            <option value="">Buy + sell</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
          </PillSelect>
          <PillSelect value={outcome} onChange={setOutcome} data-testid="filter-outcome">
            <option value="">All outcomes</option>
            {outcomes.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </PillSelect>
        </div>

        {/* ---- Status line (kept as `main > p` for QA) ---- */}
        {validAddress && (
          <p className="mb-2 px-0.5 text-xs text-muted-foreground" data-testid="status">
            {statusText}
            {statusTail}
          </p>
        )}

        {/* ---- Error banner (kept as `p.error` for QA) ---- */}
        {isError && (
          <p
            className="error mb-3 flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600"
            data-testid="error"
          >
            <span className="min-w-0 flex-1 break-words">{(error as Error).message}</span>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              onClick={() => (data ? fetchNextPage() : refetch())}
            >
              retry
            </Button>
          </p>
        )}

        {/* ---- Activity list: div-grid, virtualized ---- */}
        <Card className="overflow-hidden rounded-xl border-0 p-0 ring-1 ring-[var(--hairline)]" role="table">
          {view === 'activity' && (
            <div
              className="sticky top-0 z-10 hidden grid-cols-[120px_1fr_160px] gap-3 border-b border-hairline bg-card px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--faint)] md:grid"
              role="row"
            >
              <div role="columnheader">Type</div>
              <div role="columnheader">Market</div>
              <div role="columnheader" className="text-right">
                Amount
              </div>
            </div>
          )}

          <div
            ref={parentRef}
            onScroll={maybeFetchMore}
            className={`table-container h-[calc(100dvh-300px)] min-h-[300px] overflow-y-auto overscroll-contain ${
              view === 'raw' ? 'overflow-x-auto' : 'overflow-x-hidden'
            }`}
          >
            {loading && (
              <div className="divide-y divide-hairline">
                {Array.from({ length: 8 }).map((_, i) => (
                  <RowSkeleton key={i} />
                ))}
              </div>
            )}

            {empty && validAddress && (
              <div
                className="grid place-items-center px-4 py-16 text-sm text-muted-foreground"
                data-testid="empty"
              >
                No rows.
              </div>
            )}
            {empty && !validAddress && (
              <div
                className="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground"
                data-testid="prompt"
              >
                Enter a wallet address above to view its activity.
              </div>
            )}

            {!loading && !empty && view === 'activity' && (
              <div className="relative w-full" style={{ height: totalSize }}>
                {virtualRows.map((vRow) => {
                  const row = tableRows[vRow.index]
                  const a = row.original
                  return (
                    <div
                      key={row.id}
                      data-testid="row"
                      data-index={vRow.index}
                      ref={virtualizer.measureElement}
                      role="row"
                      className="absolute inset-x-0 top-0 px-2 pb-2 md:p-0"
                      style={{ transform: `translateY(${vRow.start}px)` }}
                    >
                      {/* Inner card: rounded card on mobile, flat hairline row on desktop */}
                      <div className="grid grid-cols-[1fr_auto] items-start gap-3 rounded-[10px] bg-card p-3 ring-1 ring-[var(--hairline)] transition-colors md:grid-cols-[120px_1fr_160px] md:items-center md:rounded-none md:border-b md:border-hairline md:px-4 md:py-3 md:ring-0 md:hover:bg-[var(--page)]">
                        {/* Type cell — desktop column only; hidden on mobile (folds into sub-line) */}
                        <div
                          role="cell"
                          data-testid="cell-type"
                          className="hidden self-center text-sm text-foreground md:block"
                        >
                          {capitalize(a.type)}
                        </div>

                        {/* Market cell — icon + title + sub-line */}
                        <div role="cell" data-testid="cell-market" className="flex min-w-0 items-start gap-3">
                        <MarketIcon src={a.icon} className="size-12 md:size-10" />
                        <div className="min-w-0 flex-1">
                          <a
                            href={eventHref(a.eventSlug)}
                            target="_blank"
                            rel="noreferrer"
                            title={a.title}
                            data-testid="market-title"
                            className="line-clamp-2 text-[15px] font-medium leading-snug text-foreground hover:underline md:line-clamp-1 md:text-sm"
                          >
                            {a.title || a.slug || '—'}
                          </a>
                          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--secondary-text)]">
                            {a.side && (
                              <span data-testid="subline-side" className="capitalize text-muted-foreground">
                                {a.side.toLowerCase()}
                              </span>
                            )}
                            {/* Type token — always rendered here so it shows on mobile */}
                            <span data-testid="subline-type" className="text-muted-foreground md:hidden">
                              {capitalize(a.type)}
                            </span>
                            {a.outcome && (
                              <OutcomeChip
                                outcome={a.outcome}
                                price={a.type === 'TRADE' ? a.price : undefined}
                              />
                            )}
                            {Number.isFinite(a.size) && a.size > 0 && (
                              <span data-testid="subline-shares">{formatNumber(a.size)} shares</span>
                            )}
                            {a.eventSlug && (
                              <a
                                href={eventHref(a.eventSlug)}
                                target="_blank"
                                rel="noreferrer"
                                data-testid="slug-link"
                                className="max-w-[40%] truncate text-[var(--brand)] hover:underline"
                                title={a.eventSlug}
                              >
                                {a.eventSlug}
                              </a>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Amount cell — usd + relative time + tx link */}
                      <div
                        role="cell"
                        data-testid="cell-amount"
                        className="flex flex-col items-end justify-start gap-0.5 text-right"
                      >
                        <span data-testid="cell-amount-usd" className="text-sm font-semibold tabular-nums text-foreground">
                          {formatUsd(a.usdcSize)}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-[var(--secondary-text)]">
                          <span title={formatTimeExact(a.timestamp)} data-testid="rel-time">
                            {relativeTime(a.timestamp)}
                          </span>
                          <a
                            href={txHref(a.transactionHash)}
                            target="_blank"
                            rel="noreferrer"
                            data-testid="tx-link"
                            title="View on Polygonscan"
                            className="text-[var(--faint)] hover:text-[var(--brand)]"
                          >
                            <ExternalLink className="size-3.5" />
                          </a>
                        </span>
                      </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {!loading && !empty && view === 'raw' && (
              <div className="min-w-[980px]" data-testid="raw-table">
                <div
                  className="sticky top-0 z-10 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline bg-card px-3 py-1.5 text-[10px] font-semibold tracking-wide text-[var(--faint)]"
                  role="row"
                  data-testid="raw-header"
                >
                  {rawTable.getHeaderGroups()[0]?.headers.map((header) => (
                    <div
                      key={header.id}
                      role="columnheader"
                      className={
                        header.id === 'price' || header.id === 'usdcSize' || header.id === 'tx'
                          ? 'text-right tabular-nums'
                          : ''
                      }
                    >
                      {String(header.column.columnDef.header)}
                    </div>
                  ))}
                </div>
                <div className="relative" style={{ height: totalSize }}>
                  {virtualRows.map((vRow) => {
                    const row = rawTableRows[vRow.index]
                    return (
                      <div
                        key={row.id}
                        data-testid="raw-row"
                        data-index={vRow.index}
                        ref={virtualizer.measureElement}
                        role="row"
                        className="absolute inset-x-0 top-0 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline px-3 py-1 text-[11px] leading-5 hover:brightness-[0.98]"
                        style={{
                          backgroundColor: rawEventTint(row.original.eventSlug),
                          transform: `translateY(${vRow.start}px)`,
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <div
                            key={cell.id}
                            role="cell"
                            className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground ${
                              cell.column.id === 'price' || cell.column.id === 'usdcSize'
                                ? 'text-right tabular-nums'
                                : cell.column.id === 'tx'
                                  ? 'flex justify-end'
                                  : ''
                            }`}
                            title={String(cell.getValue() ?? '')}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext()) ?? '—'}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {isFetchingNextPage && (
              <div className="grid place-items-center py-4 text-xs text-muted-foreground" data-testid="loading-more">
                Loading more…
              </div>
            )}
          </div>
        </Card>
      </main>

      {/* ---- Back-to-top floating pill ---- */}
      {showTop && (
        <button
          type="button"
          data-testid="back-to-top"
          onClick={() => {
            virtualizer.scrollToIndex(0)
            const el = parentRef.current
            if (el) el.scrollTop = 0
            setShowTop(false)
          }}
          className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
        >
          <ArrowUp className="size-4" />
          Back to top
        </button>
      )}
    </div>
  )
}

/** Native <select> styled as a pill (no custom listbox — keeps iOS picker). */
function PillSelect({
  value,
  onChange,
  children,
  ...rest
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
  'data-testid'?: string
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="pill-select h-9 shrink-0 cursor-pointer rounded-full border border-hairline bg-card pl-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
      {...rest}
    >
      {children}
    </select>
  )
}

function DecimalNumber({
  value,
  decimals,
  prefix = '',
}: {
  value: number
  decimals: number
  prefix?: string
}) {
  if (!Number.isFinite(value)) return '—'

  const fixed = value.toFixed(decimals)
  const [whole, fraction = ''] = fixed.split('.')
  const meaningfulLength = fraction.replace(/0+$/, '').length
  const meaningful = fraction.slice(0, meaningfulLength)
  const padding = fraction.slice(meaningfulLength)

  return (
    <span className="inline-grid grid-cols-[auto_auto_auto_auto] justify-end tabular-nums">
      <span>{prefix}{whole}</span>
      <span>.</span>
      <span>{meaningful}</span>
      <span className="text-[var(--faint)]">{padding}</span>
    </span>
  )
}

function RowSkeleton() {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-3 px-4 py-3 md:grid-cols-[120px_1fr_160px] md:items-center">
      <Skeleton className="hidden h-4 w-16 md:block" />
      <div className="flex items-start gap-3">
        <Skeleton className="size-12 rounded-lg md:size-10" />
        <div className="flex-1 space-y-2 py-0.5">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <Skeleton className="h-3.5 w-14" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  )
}
