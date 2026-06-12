<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    activityKey,
    fetchActivityPage,
    type Activity,
    type ActivityType,
    type Cursor,
    type Side,
  } from './api'
  import { formatMonthYear, formatTimeShort, shortHash } from './format'

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
  const ROW_HEIGHT = 33
  const OVERSCAN = 12
  const LOAD_AHEAD_PX = 4000

  const TYPE_OPTIONS: { value: ActivityType | ''; label: string }[] = [
    { value: '', label: 'All types' },
    { value: 'TRADE', label: 'Trade' },
    { value: 'REDEEM', label: 'Redeem' },
    { value: 'CONVERSION', label: 'Convert' },
    { value: 'SPLIT', label: 'Split' },
    { value: 'MERGE', label: 'Merge' },
    { value: 'REWARD', label: 'Reward' },
  ]

  const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`
  const addressFromUrl = () => new URLSearchParams(window.location.search).get('address')?.trim() ?? ''
  const writeAddressToUrl = (nextAddress: string) => {
    const url = new URL(window.location.href)
    if (nextAddress) url.searchParams.set('address', nextAddress)
    else url.searchParams.delete('address')
    history.replaceState(null, '', url)
  }
  const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)
  const displayType = (value: ActivityType) => (value === 'CONVERSION' ? 'Convert' : capitalize(value))

  const rawEventTint = (eventSlug: string) => {
    let hash = 0
    for (let i = 0; i < eventSlug.length; i += 1) {
      hash = (hash * 31 + eventSlug.charCodeAt(i)) >>> 0
    }
    return `hsl(${hash % 360} 72% 92% / 0.78)`
  }

  async function fetchOldestActivity(nextAddress: string, signal?: AbortSignal): Promise<Activity | null> {
    const params = new URLSearchParams({
      user: nextAddress,
      limit: '1',
      offset: '0',
      sortDirection: 'ASC',
    })
    const res = await fetch(`https://data-api.polymarket.com/activity?${params}`, { signal })
    if (!res.ok) throw new Error(`data-api ${res.status}`)
    const items = (await res.json()) as Activity[]
    return items[0] ?? null
  }

  let addressInput = addressFromUrl()
  let address = addressFromUrl()
  let type: ActivityType | '' = ''
  let side: Side | '' = ''
  let outcome = ''
  let pages: Activity[][] = []
  let nextCursor: Cursor | undefined = { offset: 0 }
  let loading = false
  let fetching = false
  let fetchingNextPage = false
  let error: Error | null = null
  let joinedActivity: Activity | null = null
  let joinedFetching = false
  let scrollTop = 0
  let viewportHeight = 300
  let showTop = false
  let requestSeq = 0
  let activeController: AbortController | null = null
  let joinedController: AbortController | null = null
  let parentRef: HTMLDivElement

  $: validAddress = ADDRESS_RE.test(address)
  $: allRows = dedupeRows(pages)
  $: outcomes = [...new Set(allRows.map((row) => row.outcome).filter(Boolean))].sort()
  $: rows = outcome ? allRows.filter((row) => row.outcome === outcome) : allRows
  $: totalSize = rows.length * ROW_HEIGHT
  $: startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  $: endIndex = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
  $: virtualRows = rows.slice(startIndex, endIndex).map((row, i) => ({
    row,
    index: startIndex + i,
    start: (startIndex + i) * ROW_HEIGHT,
  }))
  $: statusTail = fetching
    ? ' · fetching…'
    : nextCursor
      ? ' · scroll for more'
      : validAddress
        ? ' · end of history'
        : ''
  $: statusText = rows.length === allRows.length
    ? `${allRows.length} rows`
    : `${rows.length} of ${allRows.length} loaded rows`
  $: empty = !loading && rows.length === 0
  $: profile = getProfile(allRows)

  onMount(() => {
    return () => {
      activeController?.abort()
      joinedController?.abort()
    }
  })

  onDestroy(() => {
    activeController?.abort()
    joinedController?.abort()
  })

  $: void watchQueryKey(address, type, side)

  let previousQueryKey = ''
  async function watchQueryKey(nextAddress: string, nextType: ActivityType | '', nextSide: Side | '') {
    const key = `${nextAddress.toLowerCase()}|${nextType}|${nextSide}`
    if (key === previousQueryKey) return
    previousQueryKey = key
    await resetAndFetch()
  }

  function dedupeRows(sourcePages: Activity[][]) {
    const seen = new Set<string>()
    const out: Activity[] = []
    for (const page of sourcePages) {
      for (const item of page) {
        const key = activityKey(item)
        if (!seen.has(key)) {
          seen.add(key)
          out.push(item)
        }
      }
    }
    return out
  }

  function getProfile(sourceRows: Activity[]) {
    const first = sourceRows[0]
    const named = sourceRows.find((row) => row.name || row.pseudonym)
    return {
      name: named?.name || named?.pseudonym || 'Anonymous',
      image: (first as unknown as { profileImage?: string })?.profileImage,
    }
  }

  async function resetAndFetch() {
    activeController?.abort()
    const seq = ++requestSeq
    pages = []
    nextCursor = { offset: 0 }
    error = null
    fetching = false
    fetchingNextPage = false
    scrollTop = 0
    showTop = false
    if (parentRef) parentRef.scrollTop = 0
    if (!validAddress) {
      loading = false
      fetching = false
      fetchingNextPage = false
      joinedActivity = null
      return
    }
    loading = true
    await Promise.all([fetchNext(false, seq), fetchJoined(seq)])
    if (seq === requestSeq) loading = false
  }

  async function fetchJoined(seq = requestSeq) {
    joinedController?.abort()
    const controller = new AbortController()
    joinedController = controller
    joinedFetching = true
    try {
      const row = await fetchOldestActivity(address.toLowerCase(), controller.signal)
      if (seq === requestSeq) joinedActivity = row
    } catch {
      if (seq === requestSeq) joinedActivity = null
    } finally {
      if (seq === requestSeq) joinedFetching = false
    }
  }

  async function fetchNext(asNextPage = true, seq = requestSeq) {
    if (!validAddress || !nextCursor || fetchingNextPage || fetching) return
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const fetchAddress = address.toLowerCase()
    fetching = true
    fetchingNextPage = asNextPage
    try {
      const page = await fetchActivityPage(fetchAddress, { type, side }, nextCursor, controller.signal)
      if (seq !== requestSeq) return
      pages = [...pages, page.items]
      nextCursor = page.nextCursor
      error = null
    } catch (err) {
      if (seq === requestSeq && !(err instanceof DOMException && err.name === 'AbortError')) {
        error = err instanceof Error ? err : new Error(String(err))
      }
    } finally {
      if (seq === requestSeq) {
        fetching = false
        fetchingNextPage = false
        await tick()
        maybeFetchMore()
      }
    }
  }

  function submitAddress() {
    const next = addressInput.trim()
    address = next
    writeAddressToUrl(next)
  }

  function handleScroll() {
    scrollTop = parentRef.scrollTop
    viewportHeight = parentRef.clientHeight
    maybeFetchMore()
  }

  function maybeFetchMore() {
    if (!parentRef) return
    showTop = parentRef.scrollTop > 1200
    const nearBottom = parentRef.scrollHeight - parentRef.scrollTop - parentRef.clientHeight < LOAD_AHEAD_PX
    if (nearBottom && nextCursor && !fetchingNextPage && !error) {
      void fetchNext(true)
    }
  }

  function retry() {
    if (pages.length > 0) void fetchNext(true)
    else void resetAndFetch()
  }

  function backToTop() {
    if (parentRef) parentRef.scrollTop = 0
    scrollTop = 0
    showTop = false
  }

  function formatDecimal(value: number, decimals: number) {
    if (!Number.isFinite(value)) return null
    const fixed = value.toFixed(decimals)
    const [whole, fraction = ''] = fixed.split('.')
    const meaningfulLength = fraction.replace(/0+$/, '').length
    return {
      whole,
      meaningful: fraction.slice(0, meaningfulLength),
      padding: fraction.slice(meaningfulLength),
    }
  }

  function externalLinkIcon() {
    return 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3'
  }
</script>

<div class="min-h-[100dvh] bg-[var(--page)] text-foreground">
  <header class="sticky top-0 z-30 border-b border-hairline bg-[var(--page)]/90 backdrop-blur supports-[backdrop-filter]:bg-[var(--page)]/75">
    <div class="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-4 md:py-3.5">
      <div class="flex items-center gap-2">
        <span class="grid size-7 place-items-center rounded-lg bg-[var(--brand)] text-base font-bold text-white">P</span>
        <span class="text-[15px] font-semibold tracking-tight">Activity</span>
      </div>
      <form class="flex flex-1 items-center gap-2" on:submit|preventDefault={submitAddress}>
        <input
          bind:value={addressInput}
          spellcheck="false"
          autocapitalize="none"
          autocomplete="off"
          autocorrect="off"
          placeholder="0x… proxy wallet address"
          data-testid="address-input"
          class="flex h-10 flex-1 rounded-full border border-transparent bg-secondary px-3 py-1 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:max-w-[460px]"
        />
        <button type="submit" class="h-10 rounded-full bg-[var(--brand)] px-5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] md:h-9">
          Load
        </button>
      </form>
    </div>
    {#if address !== '' && !validAddress}
      <div class="mx-auto max-w-[1100px] px-4 pb-2 text-xs text-destructive" data-testid="hint">
        <span class="hint">enter a 0x… address (40 hex chars)</span>
      </div>
    {/if}
  </header>

  <main class="mx-auto max-w-[1100px] px-4 pb-24 pt-4 md:pt-6">
    {#if validAddress}
      <div class="mb-4 flex flex-row items-center gap-3 rounded-none border-0 bg-transparent px-0 py-0 shadow-none ring-0 md:gap-4 md:rounded-xl md:bg-card md:px-5 md:py-4 md:ring-1">
        <div
          class="grid size-14 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,#e8efff,#f3f4f6)] text-lg font-semibold text-[var(--brand)] ring-1 ring-hairline md:size-16"
          aria-hidden="true"
        >
          {shortHash(address).slice(2, 4).toUpperCase()}
        </div>
        <div class="min-w-0 flex-1">
          <div class="truncate text-lg font-semibold leading-tight md:text-xl" data-testid="profile-name">
            {profile.name}
          </div>
          <div class="truncate font-mono text-xs text-muted-foreground md:text-sm">
            {shortHash(address)}
          </div>
          <div class="mt-0.5 text-xs text-[var(--secondary-text)]" data-testid="profile-joined">
            {#if joinedActivity}
              Joined {formatMonthYear(joinedActivity.timestamp)}
            {:else if joinedFetching}
              Joined …
            {:else}
              &nbsp;
            {/if}
          </div>
        </div>
      </div>
    {/if}

    <div class="sticky top-[57px] z-20 -mx-4 mb-3 flex gap-2 overflow-x-auto bg-[var(--page)] px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:top-[61px]">
      <select bind:value={type} data-testid="filter-type" class="pill-select h-9 shrink-0 cursor-pointer rounded-full border border-hairline bg-card pl-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30">
        {#each TYPE_OPTIONS as option}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
      <select bind:value={side} data-testid="filter-side" class="pill-select h-9 shrink-0 cursor-pointer rounded-full border border-hairline bg-card pl-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30">
        <option value="">Buy + sell</option>
        <option value="BUY">Buy</option>
        <option value="SELL">Sell</option>
      </select>
      <select bind:value={outcome} data-testid="filter-outcome" class="pill-select h-9 shrink-0 cursor-pointer rounded-full border border-hairline bg-card pl-3.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30">
        <option value="">All outcomes</option>
        {#each outcomes as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </div>

    {#if validAddress}
      <p class="mb-2 px-0.5 text-xs text-muted-foreground" data-testid="status">
        {statusText}{statusTail}
      </p>
    {/if}

    {#if error}
      <p class="error mb-3 flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" data-testid="error">
        <span class="min-w-0 flex-1 break-words">{error.message}</span>
        <button type="button" class="h-7 shrink-0 rounded-md bg-destructive px-2.5 text-[0.8rem] font-medium text-white" on:click={retry}>
          retry
        </button>
      </p>
    {/if}

    <div class="overflow-hidden rounded-xl border-0 bg-card p-0 text-sm text-card-foreground ring-1 ring-[var(--hairline)]" role="table">
      <div
        bind:this={parentRef}
        on:scroll={handleScroll}
        class="table-container h-[calc(100dvh-260px)] min-h-[300px] overflow-y-auto overflow-x-auto overscroll-contain"
      >
        {#if loading}
          <div class="min-w-[980px]" data-testid="raw-loading">
            {@render RawHeader()}
            <div class="divide-y divide-hairline">
              {#each Array(18) as _}
                {@render RawSkeleton()}
              {/each}
            </div>
          </div>
        {/if}

        {#if empty && validAddress}
          <div class="grid place-items-center px-4 py-16 text-sm text-muted-foreground" data-testid="empty">
            No rows.
          </div>
        {/if}
        {#if empty && !validAddress}
          <div class="grid place-items-center px-4 py-16 text-center text-sm text-muted-foreground" data-testid="prompt">
            Enter a wallet address above to view its activity.
          </div>
        {/if}

        {#if !loading && !empty}
          <div class="min-w-[980px]" data-testid="raw-table">
            {@render RawHeader()}
            <div class="relative" style:height={`${totalSize}px`}>
              {#each virtualRows as item (activityKey(item.row))}
                <div
                  data-testid="raw-row"
                  data-index={item.index}
                  role="row"
                  class="absolute inset-x-0 top-0 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline px-3 py-1 text-[11px] leading-5 hover:brightness-[0.98]"
                  style:backgroundColor={rawEventTint(item.row.eventSlug)}
                  style:transform={`translateY(${item.start}px)`}
                >
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={displayType(item.row.type)}>
                    {displayType(item.row.type)}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={capitalize(item.row.side)}>
                    {capitalize(item.row.side)}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={item.row.title}>
                    {item.row.title}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={item.row.outcome}>
                    {item.row.outcome}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-right tabular-nums text-foreground" title={String(item.row.price)}>
                    {#if item.row.type === 'TRADE' && item.row.price > 0}
                      {@render DecimalNumber(item.row.price, 3)}
                    {:else}
                      <span class="text-[var(--faint)]">--</span>
                    {/if}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-right tabular-nums text-foreground" title={String(item.row.usdcSize)}>
                    {@render DecimalNumber(item.row.usdcSize, 5)}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={String(item.row.timestamp)}>
                    {formatTimeShort(item.row.timestamp)}
                  </div>
                  <div role="cell" class="flex min-w-0 justify-end overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={item.row.transactionHash}>
                    <a
                      href={txHref(item.row.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                      title={item.row.transactionHash}
                      class="inline-flex size-6 items-center justify-center rounded-full text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
                    >
                      <svg class="size-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d={externalLinkIcon()} />
                      </svg>
                      <span class="sr-only">Open transaction on Polygonscan</span>
                    </a>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if fetchingNextPage}
          <div class="grid place-items-center py-4 text-xs text-muted-foreground" data-testid="loading-more">
            Loading more…
          </div>
        {/if}
      </div>
    </div>
  </main>

  {#if showTop}
    <button
      type="button"
      data-testid="back-to-top"
      on:click={backToTop}
      class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
    >
      <span aria-hidden="true">↑</span>
      Back to top
    </button>
  {/if}
</div>

{#snippet RawHeader()}
  <div
    class="sticky top-0 z-10 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline bg-card px-3 py-1.5 text-[10px] font-semibold tracking-wide text-[var(--faint)]"
    role="row"
    data-testid="raw-header"
  >
    <div role="columnheader">Type</div>
    <div role="columnheader">Side</div>
    <div role="columnheader">Title</div>
    <div role="columnheader">Outcome</div>
    <div role="columnheader" class="text-right tabular-nums">Price</div>
    <div role="columnheader" class="text-right tabular-nums">Amount pUSD</div>
    <div role="columnheader">Time</div>
    <div role="columnheader" class="text-right tabular-nums">Tx</div>
  </div>
{/snippet}

{#snippet DecimalNumber(value: number, decimals: number)}
  {@const parts = formatDecimal(value, decimals)}
  {#if parts}
    <span class="tabular-nums"><span>{parts.whole}</span><span>.</span><span>{parts.meaningful}</span><span class="text-[var(--faint)]">{parts.padding}</span></span>
  {:else}
    —
  {/if}
{/snippet}

{#snippet RawSkeleton()}
  <div class="grid h-[33px] grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] items-center gap-2 px-3 py-1">
    <div class="h-3 w-10 animate-pulse rounded-md bg-muted"></div>
    <div class="h-3 w-8 animate-pulse rounded-md bg-muted"></div>
    <div class="h-3 w-[82%] animate-pulse rounded-md bg-muted"></div>
    <div class="h-3 w-12 animate-pulse rounded-md bg-muted"></div>
    <div class="ml-auto h-3 w-12 animate-pulse rounded-md bg-muted"></div>
    <div class="ml-auto h-3 w-16 animate-pulse rounded-md bg-muted"></div>
    <div class="h-3 w-24 animate-pulse rounded-md bg-muted"></div>
    <div class="ml-auto size-5 animate-pulse rounded-full bg-muted"></div>
  </div>
{/snippet}
