<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import {
    activityKey,
    fetchActivityPage,
    fetchEventMetadata,
    fetchPusdBalance,
    INITIAL_PAGE_SIZE,
    type Activity,
    type ActivityType,
    type Cursor,
    type EventMetadata,
    type Side,
  } from './api'
  import { formatTimeShort, shortHash } from './format'

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
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
  const CATEGORY_LABELS: Record<string, string> = {
    weather: 'Weather',
    politics: 'Politics',
    sports: 'Sports',
    crypto: 'Crypto',
    economy: 'Economy',
    finance: 'Finance',
    business: 'Business',
    culture: 'Culture',
    entertainment: 'Entertainment',
    technology: 'Technology',
    science: 'Science',
    news: 'News',
    world: 'World',
    'us-current-affairs': 'US Current Affairs',
    'international-affairs': 'International Affairs',
  }
  const CATEGORY_PRIORITY = [
    'weather',
    'politics',
    'sports',
    'crypto',
    'economy',
    'finance',
    'business',
    'culture',
    'entertainment',
    'technology',
    'science',
    'news',
    'world',
    'us-current-affairs',
    'international-affairs',
  ]
  const CATEGORY_ALIASES: Record<string, keyof typeof CATEGORY_LABELS> = {
    elections: 'politics',
    'us-election': 'politics',
    'usa-election': 'politics',
    'us-presidential-election': 'politics',
    '2024-presidential-election': 'politics',
    nba: 'sports',
    nfl: 'sports',
    mlb: 'sports',
    nhl: 'sports',
    ufc: 'sports',
    soccer: 'sports',
    football: 'sports',
    tennis: 'sports',
    golf: 'sports',
    cricket: 'sports',
    bitcoin: 'crypto',
    ethereum: 'crypto',
    solana: 'crypto',
    altcoins: 'crypto',
  }
  const IGNORED_CATEGORY_TAGS = new Set(['all', 'hide-from-new', 'recurring'])
  const CATEGORY_FETCH_CONCURRENCY = 6

  type CategoryOption = { value: string; label: string }

  const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`
  const addressFromUrl = () => new URLSearchParams(window.location.search).get('address')?.trim() ?? ''
  const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)
  const displayType = (value: ActivityType) => (value === 'CONVERSION' ? 'Convert' : capitalize(value))
  const titleCase = (value: string) =>
    value
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase())
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
  let category = ''
  let pages: Activity[][] = []
  let eventCategories: Record<string, CategoryOption | null> = {}
  let nextCursor: Cursor | undefined = { offset: 0 }
  let loading = false
  let fetching = false
  let fetchingNextPage = false
  let error: Error | null = null
  let pusdBalance: number | null = null
  let pusdBalanceFetching = false
  let showTop = false
  let requestSeq = 0
  let now = Date.now()
  let lastRefreshAt: number | null = null
  let clockTimer: number | undefined
  let refreshTimer: number | undefined
  let activeController: AbortController | null = null
  let refreshController: AbortController | null = null
  let balanceController: AbortController | null = null
  let categoryController: AbortController | null = null
  let balanceAddress = ''
  let parentRef: HTMLDivElement
  let pendingCategorySlugs = new Set<string>()

  $: validAddress = ADDRESS_RE.test(address)
  $: allRows = dedupeRows(pages)
  $: outcomes = [...new Set(allRows.map((row) => row.outcome).filter(Boolean))].sort()
  $: categoryOptions = getCategoryOptions(allRows, eventCategories)
  $: rows = filterRows(allRows, outcome, category, eventCategories)
  $: statusText = lastRefreshAt === null
    ? 'REFRESHING'
    : `${Math.max(0, Math.floor((now - lastRefreshAt) / 1000))}S SINCE REFRESH`
  $: statusCursor = nextCursor ? 'more' : validAddress ? 'end' : ''
  $: empty = !loading && rows.length === 0
  $: profile = getProfile(allRows)
  $: void hydrateEventCategories(allRows)

  onMount(() => {
    clockTimer = window.setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => {
      activeController?.abort()
      refreshController?.abort()
      balanceController?.abort()
      categoryController?.abort()
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
      if (clockTimer !== undefined) window.clearInterval(clockTimer)
    }
  })

  onDestroy(() => {
    activeController?.abort()
    refreshController?.abort()
    balanceController?.abort()
    categoryController?.abort()
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

  function cityLabel(row: Activity) {
    return compactWeatherTitle(row.title)?.city ?? row.title
  }

  function normalizeCategorySlug(value: string) {
    return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
  }

  function categoryOption(value: string): CategoryOption {
    const normalized = normalizeCategorySlug(value)
    const alias = CATEGORY_ALIASES[normalized] ?? normalized
    return { value: alias, label: CATEGORY_LABELS[alias] ?? titleCase(alias) }
  }

  function categoryFromMetadata(metadata: EventMetadata): CategoryOption | null {
    const tags = metadata.tags
      .map((tag) => ({ label: tag.label, slug: normalizeCategorySlug(tag.slug) }))
      .filter((tag) => tag.slug && !IGNORED_CATEGORY_TAGS.has(tag.slug))
    const tagSlugs = new Set(tags.map((tag) => CATEGORY_ALIASES[tag.slug] ?? tag.slug))
    for (const value of CATEGORY_PRIORITY) {
      if (tagSlugs.has(value)) return categoryOption(value)
    }
    if (metadata.category) return categoryOption(metadata.category)
    const fallback = tags[0]
    return fallback ? categoryOption(fallback.slug || fallback.label) : null
  }

  function categoryFromActivity(row: Activity): CategoryOption | null {
    const text = `${row.eventSlug} ${row.slug} ${row.title}`.toLowerCase()
    if (/\btemperature\b|\bweather\b/.test(text)) return categoryOption('weather')
    if (/\belection\b|\bmayoral\b|\bpresidential\b|\bsenate\b|\bcongress\b|\btrump\b|\bbiden\b|\bpolitics\b/.test(text)) {
      return categoryOption('politics')
    }
    if (/\bbitcoin\b|\bbtc\b|\beth\b|\bethereum\b|\bsol\b|\bsolana\b|\bcrypto\b/.test(text)) return categoryOption('crypto')
    if (/\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bufc\b|\bsoccer\b|\bfootball\b|\btennis\b|\bgolf\b|\bcricket\b/.test(text)) {
      return categoryOption('sports')
    }
    if (/\bgdp\b|\bcpi\b|\binflation\b|\bfed\b|\brate-cut\b|\beconomy\b|\brecession\b/.test(text)) return categoryOption('economy')
    return null
  }

  function getCategoryOptions(sourceRows: Activity[], sourceCategories: Record<string, CategoryOption | null>) {
    const byValue = new Map<string, string>()
    for (const row of sourceRows) {
      const option = sourceCategories[row.eventSlug]
      if (option) byValue.set(option.value, option.label)
    }
    return [...byValue.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }

  function filterRows(
    sourceRows: Activity[],
    selectedOutcome: string,
    selectedCategory: string,
    sourceCategories: Record<string, CategoryOption | null>,
  ) {
    return sourceRows.filter((row) => {
      if (selectedOutcome && row.outcome !== selectedOutcome) return false
      if (selectedCategory && sourceCategories[row.eventSlug]?.value !== selectedCategory) return false
      return true
    })
  }

  function hydrateEventCategories(sourceRows: Activity[]) {
    const nextInferred: Record<string, CategoryOption> = {}
    const rowsBySlug = new Map<string, Activity>()
    for (const row of sourceRows) {
      if (!row.eventSlug || row.eventSlug in eventCategories || pendingCategorySlugs.has(row.eventSlug)) continue
      if (!rowsBySlug.has(row.eventSlug)) rowsBySlug.set(row.eventSlug, row)
    }

    const missing: string[] = []
    for (const [slug, row] of rowsBySlug) {
      const inferred = categoryFromActivity(row)
      if (inferred) nextInferred[slug] = inferred
      else missing.push(slug)
    }

    if (Object.keys(nextInferred).length > 0) {
      eventCategories = { ...eventCategories, ...nextInferred }
    }
    if (missing.length === 0) return
    for (const slug of missing) pendingCategorySlugs.add(slug)
    if (!categoryController || categoryController.signal.aborted) categoryController = new AbortController()
    void fetchEventCategories(missing, categoryController.signal)
  }

  async function fetchEventCategories(slugs: string[], signal: AbortSignal) {
    let index = 0
    async function worker() {
      while (index < slugs.length) {
        const slug = slugs[index]
        index += 1
        try {
          const metadata = await fetchEventMetadata(slug, signal)
          eventCategories = { ...eventCategories, [slug]: categoryFromMetadata(metadata) }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            eventCategories = { ...eventCategories, [slug]: null }
          }
        } finally {
          pendingCategorySlugs.delete(slug)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CATEGORY_FETCH_CONCURRENCY, slugs.length) }, worker))
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
    const refreshPageSize = allRows.length <= INITIAL_PAGE_SIZE ? INITIAL_PAGE_SIZE : undefined
    try {
      const page = await fetchActivityPage(fetchAddress, { type, side }, { offset: 0 }, controller.signal, refreshPageSize)
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
      }
    }
  }

  function handleScroll() {
    showTop = parentRef.scrollTop > 1200
  }

  function retry() {
    if (pages.length > 0) void fetchNext(true)
    else void resetAndFetch()
  }

  function backToTop() {
    if (parentRef) parentRef.scrollTop = 0
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
          <label class="flex shrink-0 items-center border-r border-hairline text-[var(--secondary-text)]">
            <select bind:value={category} data-testid="filter-category" aria-label="Market category" class="pill-select ui-control shrink-0 cursor-pointer rounded-none border-0 bg-card font-mono text-foreground outline-none transition-colors hover:bg-secondary focus-visible:bg-secondary">
            <option value="">All Categories</option>
            {#each categoryOptions as option}
              <option value={option.value}>{option.label}</option>
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
      <p class="error ui-message flex items-center gap-3 border-x border-b border-red-600 bg-red-950/30 font-mono uppercase text-red-600" data-testid="error">
        <span class="min-w-0 flex-1 break-words">{error.message}</span>
        <button type="button" class="ui-action shrink-0 border border-red-600 bg-destructive text-white" on:click={retry}>
          retry
        </button>
      </p>
    {/if}

    <div class="h-full min-w-0 overflow-hidden border-x border-b border-hairline bg-card p-0 text-sm text-card-foreground">
      <div
        bind:this={parentRef}
        on:scroll={handleScroll}
        class="table-container h-full min-h-0 overflow-y-auto overflow-x-auto overscroll-contain"
      >
        {#if loading}
          <table class="raw-table" data-testid="raw-loading">
            {@render RawHeader()}
            <tbody>
              {#each Array(18) as _}
                {@render RawSkeleton()}
              {/each}
            </tbody>
          </table>
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
          <table class="raw-table" data-testid="raw-table">
            {@render RawHeader()}
            <tbody>
              {#each rows as row, index (activityKey(row))}
                {@const titleParts = compactWeatherTitle(row.title)}
                <tr
                  data-testid="raw-row"
                  data-category={eventCategories[row.eventSlug]?.value ?? ''}
                  data-index={index}
                  class="raw-row group"
                  style={`--row-accent: ${rawEventAccent(row.eventSlug)}`}
                >
                  <td
                    role="cell"
                    class="raw-cell raw-sticky-city font-mono text-foreground"
                    title={row.title}
                  >
                    {cityLabel(row)}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={row.title}>
                    {titleParts ? `${titleParts.temp}${titleParts.low ? ' low' : ''}` : '--'}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-[var(--secondary-text)]" title={row.title}>
                    {titleParts?.date ?? '--'}
                  </td>
                  <td role="cell" class={`raw-cell font-mono font-semibold ${sideClass(row.side)}`} title={capitalize(row.side)}>
                    {capitalize(row.side)}
                  </td>
                  <td role="cell" data-testid="cell-type" class="raw-cell font-mono text-foreground" title={displayType(row.type)}>
                    {displayType(row.type)}
                  </td>
                  <td role="cell" class={`raw-cell font-mono font-semibold ${outcomeClass(row.outcome)}`} title={row.outcome}>
                    {row.outcome}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(row.price)}>
                    {#if row.type === 'TRADE' && row.price > 0}
                      {@render DecimalNumber(row.price, 3)}
                    {:else}
                      <span class="text-[var(--faint)]">--</span>
                    {/if}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(row.usdcSize)}>
                    {@render DecimalNumber(row.usdcSize, 5)}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right tabular-nums text-foreground" title={String(row.timestamp)}>
                    {formatTimeShort(row.timestamp)}
                  </td>
                  <td role="cell" class="raw-cell justify-end font-mono text-right text-foreground" title={row.transactionHash}>
                    <a
                      href={txHref(row.transactionHash)}
                      target="_blank"
                      rel="noreferrer"
                      title={row.transactionHash}
                      class="raw-link-anchor text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
                    >
                      LINK
                    </a>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if !loading && validAddress && nextCursor}
          <div class="ui-message grid place-items-center border-t border-hairline py-4 text-muted-foreground">
            <button
              type="button"
              data-testid="load-more"
              class="ui-action border border-hairline bg-card text-foreground hover:bg-secondary disabled:cursor-wait disabled:text-muted-foreground"
              disabled={fetchingNextPage || fetching}
              on:click={() => fetchNext(true)}
            >
              {fetchingNextPage ? 'Loading more...' : 'Load more'}
            </button>
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
  <thead class="raw-head" data-testid="raw-header">
    <tr>
      <th role="columnheader" class="raw-sticky-city">City</th>
      <th role="columnheader" class="text-right tabular-nums">Temp</th>
      <th role="columnheader" class="text-right tabular-nums">Date</th>
      <th role="columnheader">Side</th>
      <th role="columnheader">Type</th>
      <th role="columnheader">Outcome</th>
      <th role="columnheader" class="text-right tabular-nums">Price</th>
      <th role="columnheader" class="text-right tabular-nums">Amount pUSD</th>
      <th role="columnheader" class="text-right tabular-nums">Time</th>
      <th role="columnheader" class="text-right tabular-nums">Tx</th>
    </tr>
  </thead>
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
  <tr class="raw-row">
    {#each Array(10) as _, i}
      <td class="raw-cell {i === 0 ? 'raw-sticky-city' : ''}">
        <span class="h-3 w-14 animate-pulse rounded-md bg-muted"></span>
      </td>
    {/each}
  </tr>
{/snippet}
