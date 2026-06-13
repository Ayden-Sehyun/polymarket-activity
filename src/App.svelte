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
  import { formatTimeShort, shortHash } from './format'

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
  const ROW_HEIGHT = 33
  const OVERSCAN = 12
  const LOAD_AHEAD_PX = 4000
  const REFRESH_INTERVAL_MS = 15_000

  const TYPE_OPTIONS: { value: ActivityType | ''; label: string }[] = [
    { value: '', label: 'All Types' },
    { value: 'TRADE', label: 'Trade' },
    { value: 'REDEEM', label: 'Redeem' },
    { value: 'CONVERSION', label: 'Convert' },
    { value: 'SPLIT', label: 'Split' },
    { value: 'MERGE', label: 'Merge' },
    { value: 'REWARD', label: 'Reward' },
  ]

  const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`
  const addressFromUrl = () => new URLSearchParams(window.location.search).get('address')?.trim() ?? ''
  const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)
  const displayType = (value: ActivityType) => (value === 'CONVERSION' ? 'Convert' : capitalize(value))
  const normalizeDate = (date: string) => date.replace(/\bJune\b/, 'Jun').replace(/\bMay\b/, 'May')
  const compactWeatherTitle = (title: string): { city: string; temp: string; date: string; low: boolean } | null => {
    const weather = title.match(
      /^Will the (highest|lowest) temperature in (.+?) be (between )?(.+?)(?: or (below|higher))? on (.+?)\?$/,
    )
    if (!weather) {
      const convertWeather = title.match(/^(Highest|Lowest) temperature in (.+?) on (.+?)\?$/)
      if (!convertWeather) return null
      const [, highLow, city, rawDate] = convertWeather
      return { city: city.trim(), temp: '--', date: normalizeDate(rawDate.trim()), low: highLow === 'Lowest' }
    }

    const [, highLow, city, between, rawTemp, direction, rawDate] = weather
    const temp = rawTemp
      .replace(/\s+/g, ' ')
      .replace(/(\d+)\s*-\s*(\d+)/, '$1-$2')
      .trim()
    const qualifier = between ? temp : direction === 'below' ? `<=${temp}` : direction === 'higher' ? `>=${temp}` : temp
    const date = normalizeDate(rawDate.trim())
    return { city: city.trim(), temp: qualifier, date, low: highLow === 'lowest' }
  }

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
  let pusdBalance: number | null = null
  let pusdBalanceFetching = false
  let theme: 'light' | 'dark' = 'light'
  let scrollTop = 0
  let viewportHeight = 300
  let showTop = false
  let requestSeq = 0
  let now = Date.now()
  let lastRefreshAt: number | null = null
  let clockTimer: number | undefined
  let refreshTimer: number | undefined
  let activeController: AbortController | null = null
  let refreshController: AbortController | null = null
  let balanceController: AbortController | null = null
  let balanceAddress = ''
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
  $: statusText = lastRefreshAt === null
    ? 'REFRESHING'
    : `${Math.max(0, Math.floor((now - lastRefreshAt) / 1000))}S SINCE REFRESH`
  $: statusCursor = nextCursor ? 'more' : validAddress ? 'end' : ''
  $: empty = !loading && rows.length === 0
  $: profile = getProfile(allRows)

  onMount(() => {
    const storedTheme = localStorage.getItem('theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    theme = storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : prefersDark ? 'dark' : 'light'
    applyTheme(theme)
    clockTimer = window.setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => {
      activeController?.abort()
      refreshController?.abort()
      balanceController?.abort()
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
      if (clockTimer !== undefined) window.clearInterval(clockTimer)
    }
  })

  onDestroy(() => {
    activeController?.abort()
    refreshController?.abort()
    balanceController?.abort()
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    if (clockTimer !== undefined) window.clearInterval(clockTimer)
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
    lastRefreshAt = null
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
      pusdBalance = null
      pusdBalanceFetching = false
      balanceAddress = ''
      return
    }
    loading = true
    const normalizedAddress = address.toLowerCase()
    if (balanceAddress !== normalizedAddress) {
      pusdBalance = null
      balanceAddress = normalizedAddress
      void fetchBalance(seq, normalizedAddress)
    }
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
      lastRefreshAt = Date.now()
      now = lastRefreshAt
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

  async function fetchBalance(seq = requestSeq, fetchAddress = address.toLowerCase()) {
    balanceController?.abort()
    const controller = new AbortController()
    balanceController = controller
    pusdBalanceFetching = true
    try {
      const balance = await fetchPusdBalance(fetchAddress, controller.signal)
      if (seq === requestSeq && balanceAddress === fetchAddress) pusdBalance = balance
    } catch {
      if (seq === requestSeq && balanceAddress === fetchAddress) pusdBalance = null
    } finally {
      if (seq === requestSeq && balanceAddress === fetchAddress) pusdBalanceFetching = false
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
      lastRefreshAt = Date.now()
      now = lastRefreshAt
      error = null
      const normalizedAddress = address.toLowerCase()
      if (balanceAddress !== normalizedAddress) {
        balanceAddress = normalizedAddress
        void fetchBalance(seq, normalizedAddress)
      }
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
      lastRefreshAt = Date.now()
      now = lastRefreshAt
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

<div class="grid h-[100dvh] min-w-0 grid-rows-[auto_1fr] overflow-hidden bg-[var(--page)] font-mono text-foreground">
  <header class="sticky top-0 z-30 border-x border-t border-hairline bg-card md:mx-auto md:w-full md:max-w-[1100px]">
    <div class="flex flex-col">
      <div class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {#if validAddress}
          <span class="ui-top-cell flex max-w-52 shrink-0 items-center truncate border-r border-hairline font-semibold text-foreground" data-testid="profile-name">{profile.name}</span>
          <span class="ui-top-cell flex shrink-0 items-center border-r border-hairline font-mono text-muted-foreground">{shortHash(address)}</span>
          <span class="ui-top-cell flex shrink-0 items-center border-r border-hairline font-mono text-[var(--secondary-text)]" data-testid="pusd-balance">
            {#if pusdBalance !== null}
              {formatPusdBalance(pusdBalance)} PUSD
            {:else if pusdBalanceFetching}
              PUSD …
            {:else}
              PUSD --
            {/if}
          </span>
          <p
            class="ui-top-cell flex shrink-0 items-center border-r border-hairline font-mono uppercase text-[var(--secondary-text)]"
            data-testid="status"
            data-shown={rows.length}
            data-total={allRows.length}
            data-cursor={statusCursor}
          >
            {statusText}
          </p>
        {:else}
          <div class="ui-top-cell flex min-w-0 flex-1 items-center font-mono uppercase text-[var(--secondary-text)]">
            Address required
          </div>
        {/if}
        <button
          type="button"
          data-testid="theme-toggle"
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          class="ui-top-cell shrink-0 bg-card font-mono font-semibold uppercase text-foreground hover:bg-secondary"
          on:click={toggleTheme}
        >
          {theme === 'dark' ? 'Light' : 'Dark'}
        </button>
      </div>

      {#if validAddress}
        <div class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <label class="flex shrink-0 items-center border-r border-hairline text-[var(--secondary-text)]">
            <select bind:value={type} data-testid="filter-type" aria-label="Activity type" class="pill-select ui-control shrink-0 cursor-pointer rounded-none border-0 bg-card font-mono text-foreground outline-none transition-colors hover:bg-secondary focus-visible:bg-secondary">
            {#each TYPE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
            </select>
          </label>
          <label class="flex shrink-0 items-center border-r border-hairline text-[var(--secondary-text)]">
            <select bind:value={side} data-testid="filter-side" aria-label="Trade side" class="pill-select ui-control shrink-0 cursor-pointer rounded-none border-0 bg-card font-mono text-foreground outline-none transition-colors hover:bg-secondary focus-visible:bg-secondary">
            <option value="">Buy + Sell</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            </select>
          </label>
          <label class="flex shrink-0 items-center border-r border-hairline text-[var(--secondary-text)]">
            <select bind:value={outcome} data-testid="filter-outcome" aria-label="Outcome" class="pill-select ui-control shrink-0 cursor-pointer rounded-none border-0 bg-card font-mono text-foreground outline-none transition-colors hover:bg-secondary focus-visible:bg-secondary">
            <option value="">Yes + No</option>
            {#each outcomes as option}
              <option value={option}>{option}</option>
            {/each}
            </select>
          </label>
        </div>
      {/if}

      {#if address !== '' && !validAddress}
        <div class="ui-message border-b border-hairline uppercase text-destructive" data-testid="hint">
          <span class="hint">Enter a 0x… address (40 hex chars)</span>
        </div>
      {/if}
    </div>
  </header>

  <main class="mx-auto min-h-0 min-w-0 w-full max-w-[1100px] px-0 pb-0 pt-0 md:px-0">
    {#if error}
      <p class="error ui-message flex items-center gap-3 border-x border-b border-red-600 bg-red-50 font-mono uppercase text-red-600 dark:bg-red-950/30" data-testid="error">
        <span class="min-w-0 flex-1 break-words">{error.message}</span>
        <button type="button" class="ui-action shrink-0 border border-red-600 bg-destructive text-white" on:click={retry}>
          retry
        </button>
      </p>
    {/if}

    <div class="h-full min-w-0 overflow-hidden border-x border-b border-hairline bg-card p-0 text-sm text-card-foreground" role="table">
      <div
        bind:this={parentRef}
        on:scroll={handleScroll}
        class="table-container h-full min-h-0 overflow-y-auto overflow-x-auto overscroll-contain"
      >
        {#if loading}
          <div class="min-w-[874px]" data-testid="raw-loading">
            {@render RawHeader()}
            <div class="divide-y divide-hairline">
              {#each Array(18) as _}
                {@render RawSkeleton()}
              {/each}
            </div>
          </div>
        {/if}

        {#if empty && validAddress}
          <div class="ui-empty grid place-items-center text-muted-foreground" data-testid="empty">
            No rows.
          </div>
        {/if}
        {#if empty && !validAddress}
          <div class="ui-empty grid place-items-center text-center text-muted-foreground" data-testid="prompt">
            Add ?address=0x… to the URL to view activity.
          </div>
        {/if}

        {#if !loading && !empty}
          <div class="min-w-[874px]" data-testid="raw-table">
            {@render RawHeader()}
            <div class="relative" style:height={`${totalSize}px`}>
              {#each virtualRows as item (activityKey(item.row))}
                {@const titleParts = compactWeatherTitle(item.row.title)}
                <div
                  data-testid="raw-row"
                  data-index={item.index}
                  role="row"
                  class="raw-grid raw-row group absolute inset-x-0 top-0 grid border-b border-hairline hover:bg-secondary/60"
                  style={`transform: translateY(${item.start}px); --row-accent: ${rawEventAccent(item.row.eventSlug)}`}
                >
                  <div
                    role="cell"
                    class="raw-cell raw-sticky-city font-mono text-foreground"
                    title={item.row.title}
                  >
                    {titleParts?.city ?? item.row.title}
                  </div>
                  <div role="cell" class="raw-cell raw-sticky-temp justify-end font-mono text-right tabular-nums text-foreground" title={item.row.title}>
                    {titleParts ? `${titleParts.temp}${titleParts.low ? ' low' : ''}` : '--'}
                  </div>
                  <div role="cell" class="raw-cell raw-sticky-date justify-end font-mono text-right tabular-nums text-[var(--secondary-text)]" title={item.row.title}>
                    {titleParts?.date ?? '--'}
                  </div>
                  <div role="cell" class={`raw-cell font-mono font-semibold ${sideClass(item.row.side)}`} title={capitalize(item.row.side)}>
                    {capitalize(item.row.side)}
                  </div>
                  <div role="cell" class="raw-cell font-mono text-foreground" title={displayType(item.row.type)}>
                    {displayType(item.row.type)}
                  </div>
                  <div role="cell" class={`raw-cell font-mono font-semibold ${outcomeClass(item.row.outcome)}`} title={item.row.outcome}>
                    {item.row.outcome}
                  </div>
                  <div role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(item.row.price)}>
                    {#if item.row.type === 'TRADE' && item.row.price > 0}
                      {@render DecimalNumber(item.row.price, 3)}
                    {:else}
                      <span class="text-[var(--faint)]">--</span>
                    {/if}
                  </div>
                  <div role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(item.row.usdcSize)}>
                    {@render DecimalNumber(item.row.usdcSize, 5)}
                  </div>
                  <div role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(item.row.timestamp)}>
                    {formatTimeShort(item.row.timestamp)}
                  </div>
                  <div role="cell" class="raw-cell justify-end font-mono text-right text-foreground" title={item.row.transactionHash}>
                    <a
                      href={txHref(item.row.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                      title={item.row.transactionHash}
                      class="raw-link-anchor text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
                    >
                      LINK
                    </a>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        {#if fetchingNextPage}
          <div class="ui-message grid place-items-center py-4 text-muted-foreground" data-testid="loading-more">
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
      class="ui-floating-action fixed bottom-5 left-1/2 z-40 flex min-w-28 -translate-x-1/2 touch-manipulation items-center justify-center gap-1.5 border border-hairline bg-primary font-mono text-primary-foreground shadow-lg"
    >
      <span aria-hidden="true">↑</span>
      Back to top
    </button>
  {/if}
</div>

{#snippet RawHeader()}
  <div
    class="raw-grid raw-head sticky top-0 z-10 grid border-b border-hairline bg-secondary"
    role="row"
    data-testid="raw-header"
  >
    <div role="columnheader" class="raw-sticky-city-head">City</div>
    <div role="columnheader" class="raw-sticky-temp-head text-right tabular-nums">Temp</div>
    <div role="columnheader" class="raw-sticky-date-head text-right tabular-nums">Date</div>
    <div role="columnheader">Side</div>
    <div role="columnheader">Type</div>
    <div role="columnheader">Outcome</div>
    <div role="columnheader" class="text-right tabular-nums">Price</div>
    <div role="columnheader" class="text-right tabular-nums">Amount pUSD</div>
    <div role="columnheader" class="text-right tabular-nums">Time</div>
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
  <div class="raw-grid grid items-center px-5 py-1" style:height="var(--h-row)">
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
