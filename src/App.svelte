<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import {
    activityKey,
    fetchActivityPage,
    fetchPusdBalance,
    INITIAL_PAGE_SIZE,
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
  const REFRESH_INTERVAL_MS = 15_000

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

  const rawEventAccent = (eventSlug: string) => {
    let hash = 0
    for (let i = 0; i < eventSlug.length; i += 1) {
      hash = (hash * 31 + eventSlug.charCodeAt(i)) >>> 0
    }
    return `hsl(${hash % 360} 62% 42% / 0.9)`
  }
  const sideClass = (value: Side | '') =>
    value === 'BUY'
      ? 'text-green-600'
      : value === 'SELL'
        ? 'text-red-600'
        : 'text-foreground'
  const outcomeClass = (value: string) =>
    value.toLowerCase() === 'yes'
      ? 'text-green-600'
      : value.toLowerCase() === 'no'
        ? 'text-red-600'
        : 'text-foreground'

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
  let pusdBalance: number | null = null
  let pusdBalanceFetching = false
  let theme: 'light' | 'dark' = 'light'
  let scrollTop = 0
  let viewportHeight = 300
  let showTop = false
  let requestSeq = 0
  let refreshTimer: number | undefined
  let activeController: AbortController | null = null
  let refreshController: AbortController | null = null
  let joinedController: AbortController | null = null
  let balanceController: AbortController | null = null
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
    const storedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    theme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : prefersDark ? 'dark' : 'light'
    applyTheme(theme)
    return () => {
      activeController?.abort()
      refreshController?.abort()
      joinedController?.abort()
      balanceController?.abort()
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    }
  })

  onDestroy(() => {
    activeController?.abort()
    refreshController?.abort()
    joinedController?.abort()
    balanceController?.abort()
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
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
    refreshController?.abort()
    if (refreshTimer !== undefined) {
      window.clearInterval(refreshTimer)
      refreshTimer = undefined
    }
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
      pusdBalance = null
      pusdBalanceFetching = false
      return
    }
    loading = true
    void fetchJoined(seq)
    void fetchBalance(seq)
    await fetchInitialRows(seq)
    if (seq === requestSeq) startRefreshTimer(seq)
  }

  function startRefreshTimer(seq: number) {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    refreshTimer = window.setInterval(() => {
      void refreshLatest(seq)
    }, REFRESH_INTERVAL_MS)
  }

  async function fetchInitialRows(seq = requestSeq) {
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    const fetchAddress = address.toLowerCase()
    fetching = true
    try {
      const page = await fetchActivityPage(fetchAddress, { type, side }, { offset: 0 }, controller.signal, INITIAL_PAGE_SIZE)
      if (seq !== requestSeq) return
      pages = [page.items]
      nextCursor = page.items.length === INITIAL_PAGE_SIZE ? { offset: 0 } : undefined
      error = null
    } catch (err) {
      if (seq === requestSeq && !(err instanceof DOMException && err.name === 'AbortError')) {
        error = err instanceof Error ? err : new Error(String(err))
      }
    } finally {
      if (seq === requestSeq) {
        loading = false
        fetching = false
        fetchingNextPage = false
        await tick()
        if (nextCursor) {
          requestAnimationFrame(() => {
            if (seq === requestSeq) void fetchNext(true)
          })
        }
      }
    }
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

  async function fetchBalance(seq = requestSeq) {
    balanceController?.abort()
    const controller = new AbortController()
    balanceController = controller
    pusdBalance = null
    pusdBalanceFetching = true
    try {
      const balance = await fetchPusdBalance(address.toLowerCase(), controller.signal)
      if (seq === requestSeq) pusdBalance = balance
    } catch {
      if (seq === requestSeq) pusdBalance = null
    } finally {
      if (seq === requestSeq) pusdBalanceFetching = false
    }
  }

  async function refreshLatest(seq = requestSeq) {
    if (!validAddress) return
    refreshController?.abort()
    const controller = new AbortController()
    refreshController = controller
    const fetchAddress = address.toLowerCase()
    try {
      const page = await fetchActivityPage(fetchAddress, { type, side }, { offset: 0 }, controller.signal)
      if (seq !== requestSeq) return
      pages = mergeLatestPage(pages, page.items)
      error = null
      void fetchJoined(seq)
      void fetchBalance(seq)
    } catch (err) {
      if (seq === requestSeq && !(err instanceof DOMException && err.name === 'AbortError')) {
        error = err instanceof Error ? err : new Error(String(err))
      }
    }
  }

  function mergeLatestPage(sourcePages: Activity[][], latestItems: Activity[]) {
    if (sourcePages.length === 0) return [latestItems]
    const latestKeys = new Set(latestItems.map(activityKey))
    const rest = sourcePages.flat().filter((item) => !latestKeys.has(activityKey(item)))
    return [latestItems, rest]
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

  function formatPusdBalance(value: number) {
    return new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  }

  function externalLinkIcon() {
    return 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14 21 3'
  }

  function applyTheme(nextTheme: 'light' | 'dark') {
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
    document.documentElement.style.colorScheme = nextTheme
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('theme', theme)
    applyTheme(theme)
  }
</script>

<div class="grid h-[100dvh] min-w-0 grid-rows-[auto_1fr] overflow-hidden bg-[var(--page)] text-foreground">
  <header class="sticky top-0 z-30 border-b border-hairline bg-[var(--page)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--page)]/85">
    <div class="mx-auto flex max-w-[1100px] flex-col gap-2 px-4 py-2">
      <div class="flex items-center gap-2">
        <form class="flex min-w-0 flex-1 items-center gap-2" on:submit|preventDefault={submitAddress}>
          <input
            bind:value={addressInput}
            spellcheck="false"
            autocapitalize="none"
            autocomplete="off"
            autocorrect="off"
            placeholder="0x… proxy wallet address"
            data-testid="address-input"
            class="h-10 min-w-0 flex-1 rounded-full border border-transparent bg-secondary px-3 py-1 text-base outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9"
          />
          <button type="submit" class="h-10 shrink-0 rounded-full bg-[var(--brand)] px-4 text-sm font-medium text-white hover:bg-[var(--brand-hover)] md:h-9">
            Load
          </button>
        </form>
        <button
          type="button"
          data-testid="theme-toggle"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          class="h-10 shrink-0 rounded-full border border-hairline bg-card px-3 text-sm font-medium text-foreground hover:bg-secondary md:h-9"
          on:click={toggleTheme}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      {#if validAddress}
        <div class="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground md:flex-row md:items-center md:justify-between md:gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate font-medium text-foreground" data-testid="profile-name">{profile.name}</span>
            <span class="shrink-0 text-[var(--faint)]">/</span>
            <span class="shrink-0 font-mono">{shortHash(address)}</span>
            <span class="shrink-0 text-[var(--faint)]">/</span>
            <span class="shrink-0 text-[var(--secondary-text)]" data-testid="profile-joined">
              {#if joinedActivity}
                Joined {formatMonthYear(joinedActivity.timestamp)}
              {:else if joinedFetching}
                Joined …
              {:else}
                &nbsp;
              {/if}
            </span>
            <span class="shrink-0 text-[var(--faint)]">/</span>
            <span class="shrink-0 font-mono text-[var(--secondary-text)]" data-testid="pusd-balance">
              {#if pusdBalance !== null}
                {formatPusdBalance(pusdBalance)} pUSD
              {:else if pusdBalanceFetching}
                pUSD …
              {:else}
                pUSD --
              {/if}
            </span>
          </div>
          <p class="shrink-0 font-mono text-[11px] text-muted-foreground" data-testid="status">
            {statusText}{statusTail}
          </p>
        </div>
      {/if}

      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

      {#if address !== '' && !validAddress}
        <div class="text-xs text-destructive" data-testid="hint">
          <span class="hint">enter a 0x… address (40 hex chars)</span>
        </div>
      {/if}
    </div>
  </header>

  <main class="mx-auto min-h-0 min-w-0 w-full max-w-[1100px] px-4 pb-4 pt-3">
    {#if error}
      <p class="error mb-3 flex items-center gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600" data-testid="error">
        <span class="min-w-0 flex-1 break-words">{error.message}</span>
        <button type="button" class="h-7 shrink-0 rounded-md bg-destructive px-2.5 text-[0.8rem] font-medium text-white" on:click={retry}>
          retry
        </button>
      </p>
    {/if}

    <div class="h-full min-w-0 overflow-hidden rounded-xl border-0 bg-card p-0 text-sm text-card-foreground ring-1 ring-[var(--hairline)]" role="table">
      <div
        bind:this={parentRef}
        on:scroll={handleScroll}
        class="table-container h-full min-h-0 overflow-y-auto overflow-x-auto overscroll-contain"
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
                  class="absolute inset-x-0 top-0 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline px-3 py-1 pl-4 text-[11px] leading-5 hover:bg-secondary/40"
                  style:border-left={`4px solid ${rawEventAccent(item.row.eventSlug)}`}
                  style:transform={`translateY(${item.start}px)`}
                >
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={displayType(item.row.type)}>
                    {displayType(item.row.type)}
                  </div>
                  <div role="cell" class={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] font-semibold ${sideClass(item.row.side)}`} title={capitalize(item.row.side)}>
                    {capitalize(item.row.side)}
                  </div>
                  <div role="cell" class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] text-foreground" title={item.row.title}>
                    {item.row.title}
                  </div>
                  <div role="cell" class={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[10.5px] font-semibold ${outcomeClass(item.row.outcome)}`} title={item.row.outcome}>
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
    class="sticky top-0 z-10 grid grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] gap-2 border-b border-hairline bg-card py-1.5 pl-5 pr-3 text-[10px] font-semibold tracking-wide text-[var(--faint)]"
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
  <div class="grid h-[33px] grid-cols-[72px_56px_1fr_92px_74px_96px_128px_32px] items-center gap-2 py-1 pl-5 pr-3">
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
