<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    activityKey,
    fetchActivityPage,
    fetchEventMetadata,
    fetchPusdBalance,
    INITIAL_PAGE_SIZE,
    type Activity,
    type ActivityType,
    type Cursor,
    type Side,
  } from './api'
  import {
    areCategoriesSettled,
    categoryForRow,
    categoryFromActivity,
    categoryFromMetadata,
    DEFAULT_CATEGORY,
    filterRows,
    getCategoryOptions,
    type CategoryOption,
  } from './category'
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
  const CATEGORY_FETCH_CONCURRENCY = 6
  const AUTO_FILL_MAX_PAGES = 4
  const STICKY_STORAGE_KEY = 'activity-sticky-columns'
  const VISIBLE_STORAGE_KEY = 'activity-visible-columns'
  const COLUMN_DEFS = [
    { id: 'city', label: 'City' },
    { id: 'temp', label: 'Temp' },
    { id: 'date', label: 'Date' },
    { id: 'side', label: 'Side' },
    { id: 'type', label: 'Type' },
    { id: 'outcome', label: 'Outcome' },
    { id: 'price', label: 'Price' },
    { id: 'amount', label: 'Amount pUSD' },
    { id: 'time', label: 'Time' },
    { id: 'tx', label: 'Tx' },
  ] as const

  type ColumnId = (typeof COLUMN_DEFS)[number]['id']

  const ALL_COLUMN_IDS = COLUMN_DEFS.map((column) => column.id)

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
  let category = DEFAULT_CATEGORY
  let stickyColumns: ColumnId[] = ['city']
  let visibleColumns: ColumnId[] = ALL_COLUMN_IDS
  let stickyOffsets: Partial<Record<ColumnId, number>> = {}
  let pages: Activity[][] = []
  let eventCategories: Record<string, CategoryOption | null> = {}
  let nextCursor: Cursor | undefined = { offset: 0 }
  let loading = false
  let fetching = false
  let fetchingNextPage = false
  let autoFilling = false
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
  let tableRef: HTMLTableElement
  let measureRaf: number | undefined
  let pendingCategorySlugs = new Set<string>()
  let autoFillKey = ''
  let autoFillAttempts = 0

  $: validAddress = ADDRESS_RE.test(address)
  $: allRows = dedupeRows(pages)
  $: outcomes = [...new Set(allRows.map((row) => row.outcome).filter(Boolean))].sort()
  $: categoryOptions = getCategoryOptions(allRows, eventCategories)
  $: rows = filterRows(allRows, outcome, category, eventCategories)
  $: clientFilterActive = Boolean(outcome || category)
  $: categoriesSettled = areCategoriesSettled(allRows, eventCategories)
  $: currentAutoFillKey = `${requestSeq}|${outcome}|${category}`
  $: if (currentAutoFillKey !== autoFillKey) {
    autoFillKey = currentAutoFillKey
    autoFillAttempts = 0
  }
  $: visibleKey = visibleColumns.join('|')
  $: visibleByColumn = getVisibleByColumn(visibleColumns)
  $: visibleColumnDefs = COLUMN_DEFS.filter((column) => visibleByColumn[column.id])
  $: firstVisibleColumn = visibleColumnDefs[0]?.id
  $: activeStickyColumns = stickyColumns.filter((column) => visibleByColumn[column])
  $: stickyKey = activeStickyColumns.join('|')
  $: stickyByColumn = getStickyByColumn(activeStickyColumns)
  $: stickyClassByColumn = getStickyClassByColumn(stickyByColumn)
  $: stickyStyleByColumn = getStickyStyleByColumn(stickyByColumn, stickyOffsets)
  $: stickySummary = activeStickyColumns.length === 0
    ? 'None Sticky'
    : `Sticky: ${activeStickyColumns.map((column) => COLUMN_DEFS.find((def) => def.id === column)?.label ?? column).join(' + ')}`
  $: visibleSummary = visibleColumns.length === COLUMN_DEFS.length
    ? 'Cols: All'
    : `Cols: ${visibleColumns.length}/${COLUMN_DEFS.length}`
  $: {
    rows.length
    visibleKey
    stickyKey
    if (!loading) void scheduleStickyMeasure()
  }
  $: statusText = lastRefreshAt === null
    ? 'REFRESHING'
    : `${Math.max(0, Math.floor((now - lastRefreshAt) / 1000))}S SINCE REFRESH`
  $: statusCursor = nextCursor ? 'more' : validAddress ? 'end' : ''
  $: filteredRowsPending = clientFilterActive && allRows.length > 0 && rows.length === 0 && (!categoriesSettled || autoFilling)
  $: empty = !loading && !filteredRowsPending && rows.length === 0
  $: profile = getProfile(allRows)
  $: void hydrateEventCategories(allRows)
  $: void maybeAutoFillFilteredRows(
    currentAutoFillKey,
    validAddress,
    clientFilterActive,
    loading,
    fetching,
    autoFilling,
    allRows.length,
    rows.length,
    nextCursor,
  )

  onMount(() => {
    visibleColumns = readVisibleColumns()
    stickyColumns = readStickyColumns().filter((column) => visibleColumns.includes(column))
    clockTimer = window.setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => {
      cleanupRuntime()
    }
  })

  function cleanupRuntime() {
    activeController?.abort()
    refreshController?.abort()
    balanceController?.abort()
    categoryController?.abort()
    if (measureRaf !== undefined) window.cancelAnimationFrame(measureRaf)
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    if (clockTimer !== undefined) window.clearInterval(clockTimer)
  }

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
    const named = sourceRows.find((row) => row.name || row.pseudonym)
    return {
      name: named?.name || named?.pseudonym || 'Anonymous',
    }
  }

  function cityLabel(row: Activity) {
    return compactWeatherTitle(row.title)?.city ?? row.title
  }

  function readStickyColumns(): ColumnId[] {
    return readColumnList(STICKY_STORAGE_KEY, ['city'])
  }

  function readVisibleColumns(): ColumnId[] {
    return readColumnList(VISIBLE_STORAGE_KEY, ALL_COLUMN_IDS, true)
  }

  function readColumnList(key: string, fallback: ColumnId[], requireOne = false) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return fallback
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return fallback
      const valid = parsed.filter((value): value is ColumnId => ALL_COLUMN_IDS.includes(value as ColumnId))
      return valid.length > 0 || !requireOne ? orderColumns(valid) : fallback
    } catch {
      return fallback
    }
  }

  function orderColumns(columns: ColumnId[]) {
    const selected = new Set(columns)
    return ALL_COLUMN_IDS.filter((id) => selected.has(id))
  }

  function toggleStickyColumn(column: ColumnId) {
    const selected = new Set(stickyColumns)
    if (selected.has(column)) selected.delete(column)
    else selected.add(column)
    const next = orderColumns([...selected])
    stickyColumns = next
    localStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(next))
    void scheduleStickyMeasure()
  }

  function toggleVisibleColumn(column: ColumnId) {
    const selected = new Set(visibleColumns)
    if (selected.has(column)) {
      if (selected.size === 1) return
      selected.delete(column)
    } else {
      selected.add(column)
    }

    const nextVisible = orderColumns([...selected])
    const nextSticky = stickyColumns.filter((id) => nextVisible.includes(id))
    visibleColumns = nextVisible
    stickyColumns = nextSticky
    localStorage.setItem(VISIBLE_STORAGE_KEY, JSON.stringify(nextVisible))
    localStorage.setItem(STICKY_STORAGE_KEY, JSON.stringify(nextSticky))
    void scheduleStickyMeasure()
  }

  function getVisibleByColumn(columns: ColumnId[]) {
    const selected = new Set(columns)
    return COLUMN_DEFS.reduce(
      (out, column) => {
        out[column.id] = selected.has(column.id)
        return out
      },
      {} as Record<ColumnId, boolean>,
    )
  }

  function getStickyByColumn(columns: ColumnId[]) {
    const selected = new Set(columns)
    return COLUMN_DEFS.reduce(
      (out, column) => {
        out[column.id] = selected.has(column.id)
        return out
      },
      {} as Record<ColumnId, boolean>,
    )
  }

  function getStickyClassByColumn(sourceStickyByColumn: Record<ColumnId, boolean>) {
    return COLUMN_DEFS.reduce(
      (out, column) => {
        out[column.id] = sourceStickyByColumn[column.id] ? 'raw-sticky-cell' : ''
        return out
      },
      {} as Record<ColumnId, string>,
    )
  }

  function getStickyStyleByColumn(
    sourceStickyByColumn: Record<ColumnId, boolean>,
    sourceStickyOffsets: Partial<Record<ColumnId, number>>,
  ) {
    return COLUMN_DEFS.reduce(
      (out, column) => {
        out[column.id] = sourceStickyByColumn[column.id] ? `left: ${sourceStickyOffsets[column.id] ?? 0}px` : ''
        return out
      },
      {} as Record<ColumnId, string>,
    )
  }

  async function scheduleStickyMeasure() {
    if (loading || typeof window === 'undefined') return
    if (measureRaf !== undefined) window.cancelAnimationFrame(measureRaf)
    await tick()
    measureRaf = window.requestAnimationFrame(() => {
      measureRaf = undefined
      measureStickyOffsets()
    })
  }

  function measureStickyOffsets() {
    if (!tableRef) return
    let left = 0
    const next: Partial<Record<ColumnId, number>> = {}
    for (const column of COLUMN_DEFS) {
      if (!stickyByColumn[column.id]) continue
      next[column.id] = left
      const header = tableRef.querySelector<HTMLElement>(`[data-col="${column.id}"]`)
      left += header?.getBoundingClientRect().width ?? 0
    }
    stickyOffsets = next
  }

  function handleColumnMenuToggle(event: Event) {
    const details = event.currentTarget as HTMLDetailsElement
    const panel = details.querySelector<HTMLElement>('.column-menu-panel')
    if (!panel || typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const detailsRect = details.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const left = Math.max(4, Math.min(detailsRect.left, window.innerWidth - panelRect.width - 4))
      panel.style.setProperty('--column-menu-left', `${left}px`)
      panel.style.setProperty('--column-menu-top', `${detailsRect.bottom}px`)
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

  async function maybeAutoFillFilteredRows(
    key: string,
    isValidAddress: boolean,
    isClientFilterActive: boolean,
    isLoading: boolean,
    isFetching: boolean,
    isAutoFilling: boolean,
    loadedCount: number,
    visibleCount: number,
    cursor: Cursor | undefined,
  ) {
    if (
      !isValidAddress ||
      !isClientFilterActive ||
      isLoading ||
      isFetching ||
      isAutoFilling ||
      loadedCount === 0 ||
      visibleCount > 0 ||
      !cursor ||
      autoFillAttempts >= AUTO_FILL_MAX_PAGES
    ) {
      return
    }

    autoFillAttempts += 1
    autoFilling = true
    try {
      await fetchNext(false)
    } finally {
      if (key === autoFillKey) autoFilling = false
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
    autoFilling = false
    autoFillAttempts = 0
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
        <div data-testid="filter-row" class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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

        <div data-testid="config-row" class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <details class="column-menu relative flex shrink-0 border-r border-hairline" on:toggle={handleColumnMenuToggle}>
            <summary
              data-testid="sticky-summary"
              class="ui-control flex min-w-36 cursor-pointer list-none items-center bg-card pr-3 text-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden"
            >
              {stickySummary}
            </summary>
            <div class="column-menu-panel z-50 grid min-w-48 border border-hairline bg-card shadow-lg" data-testid="sticky-menu">
              {#each COLUMN_DEFS as column}
                <label class={`flex cursor-pointer items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[11px] uppercase leading-4 last:border-b-0 hover:bg-secondary ${visibleByColumn[column.id] ? 'text-foreground' : 'text-[var(--faint)]'}`}>
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={stickyByColumn[column.id]}
                    disabled={!visibleByColumn[column.id]}
                    data-testid={`sticky-${column.id}`}
                    on:change={() => toggleStickyColumn(column.id)}
                  />
                  <span>{column.label}</span>
                </label>
              {/each}
            </div>
          </details>
          <details class="column-menu relative flex shrink-0 border-r border-hairline" on:toggle={handleColumnMenuToggle}>
            <summary
              data-testid="columns-summary"
              class="ui-control flex min-w-28 cursor-pointer list-none items-center bg-card pr-3 text-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden"
            >
              {visibleSummary}
            </summary>
            <div class="column-menu-panel z-50 grid min-w-48 border border-hairline bg-card shadow-lg" data-testid="columns-menu">
              {#each COLUMN_DEFS as column}
                {@const isLastVisible = visibleColumns.length === 1 && visibleByColumn[column.id]}
                <label class={`flex cursor-pointer items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[11px] uppercase leading-4 text-foreground last:border-b-0 hover:bg-secondary ${isLastVisible ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={visibleByColumn[column.id]}
                    disabled={isLastVisible}
                    data-testid={`column-${column.id}`}
                    on:change={() => toggleVisibleColumn(column.id)}
                  />
                  <span>{column.label}</span>
                </label>
              {/each}
            </div>
          </details>
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
        {#if loading || filteredRowsPending}
          <table bind:this={tableRef} class="raw-table" data-testid="raw-loading">
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

        {#if !loading && rows.length > 0}
          <table bind:this={tableRef} class="raw-table" data-testid="raw-table">
            {@render RawHeader()}
            <tbody>
              {#each rows as row, index (activityKey(row))}
                {@const titleParts = compactWeatherTitle(row.title)}
                <tr
                  data-testid="raw-row"
                  data-category={categoryForRow(row, eventCategories)?.value ?? ''}
                  data-index={index}
                  class="raw-row group"
                  style={`--row-accent: ${rawEventAccent(row.eventSlug)}`}
                >
                  {#if visibleByColumn.city}
                    <td
                      role="cell"
                      data-col="city"
                      class={`raw-cell font-mono text-foreground ${firstVisibleColumn === 'city' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.city}`}
                      style={stickyStyleByColumn.city}
                      title={row.title}
                    >
                      {cityLabel(row)}
                    </td>
                  {/if}
                  {#if visibleByColumn.temp}
                    <td role="cell" data-col="temp" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'temp' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.temp}`} style={stickyStyleByColumn.temp} title={row.title}>
                      {titleParts ? `${titleParts.temp}${titleParts.low ? ' low' : ''}` : '--'}
                    </td>
                  {/if}
                  {#if visibleByColumn.date}
                    <td role="cell" data-col="date" class={`raw-cell justify-end font-mono text-right tabular-nums text-[var(--secondary-text)] ${firstVisibleColumn === 'date' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.date}`} style={stickyStyleByColumn.date} title={row.title}>
                      {titleParts?.date ?? '--'}
                    </td>
                  {/if}
                  {#if visibleByColumn.side}
                    <td role="cell" data-col="side" class={`raw-cell font-mono font-semibold ${sideClass(row.side)} ${firstVisibleColumn === 'side' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.side}`} style={stickyStyleByColumn.side} title={capitalize(row.side)}>
                      {capitalize(row.side)}
                    </td>
                  {/if}
                  {#if visibleByColumn.type}
                    <td role="cell" data-col="type" data-testid="cell-type" class={`raw-cell font-mono text-foreground ${firstVisibleColumn === 'type' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.type}`} style={stickyStyleByColumn.type} title={displayType(row.type)}>
                      {displayType(row.type)}
                    </td>
                  {/if}
                  {#if visibleByColumn.outcome}
                    <td role="cell" data-col="outcome" class={`raw-cell font-mono font-semibold ${outcomeClass(row.outcome)} ${firstVisibleColumn === 'outcome' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.outcome}`} style={stickyStyleByColumn.outcome} title={row.outcome}>
                      {row.outcome}
                    </td>
                  {/if}
                  {#if visibleByColumn.price}
                    <td role="cell" data-col="price" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'price' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.price}`} style={stickyStyleByColumn.price} title={String(row.price)}>
                      {#if row.type === 'TRADE' && row.price > 0}
                        {@render DecimalNumber(row.price, 3)}
                      {:else}
                        <span class="text-[var(--faint)]">--</span>
                      {/if}
                    </td>
                  {/if}
                  {#if visibleByColumn.amount}
                    <td role="cell" data-col="amount" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'amount' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.amount}`} style={stickyStyleByColumn.amount} title={String(row.usdcSize)}>
                      {@render DecimalNumber(row.usdcSize, 5)}
                    </td>
                  {/if}
                  {#if visibleByColumn.time}
                    <td role="cell" data-col="time" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'time' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.time}`} style={stickyStyleByColumn.time} title={String(row.timestamp)}>
                      {formatTimeShort(row.timestamp)}
                    </td>
                  {/if}
                  {#if visibleByColumn.tx}
                    <td role="cell" data-col="tx" class={`raw-cell justify-end font-mono text-right text-foreground ${firstVisibleColumn === 'tx' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.tx}`} style={stickyStyleByColumn.tx} title={row.transactionHash}>
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
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}

        {#if !loading && !filteredRowsPending && validAddress && nextCursor}
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
      {#if visibleByColumn.city}
        <th role="columnheader" data-col="city" class={stickyClassByColumn.city} style={stickyStyleByColumn.city}>City</th>
      {/if}
      {#if visibleByColumn.temp}
        <th role="columnheader" data-col="temp" class={`text-right tabular-nums ${stickyClassByColumn.temp}`} style={stickyStyleByColumn.temp}>Temp</th>
      {/if}
      {#if visibleByColumn.date}
        <th role="columnheader" data-col="date" class={`text-right tabular-nums ${stickyClassByColumn.date}`} style={stickyStyleByColumn.date}>Date</th>
      {/if}
      {#if visibleByColumn.side}
        <th role="columnheader" data-col="side" class={stickyClassByColumn.side} style={stickyStyleByColumn.side}>Side</th>
      {/if}
      {#if visibleByColumn.type}
        <th role="columnheader" data-col="type" class={stickyClassByColumn.type} style={stickyStyleByColumn.type}>Type</th>
      {/if}
      {#if visibleByColumn.outcome}
        <th role="columnheader" data-col="outcome" class={stickyClassByColumn.outcome} style={stickyStyleByColumn.outcome}>Outcome</th>
      {/if}
      {#if visibleByColumn.price}
        <th role="columnheader" data-col="price" class={`text-right tabular-nums ${stickyClassByColumn.price}`} style={stickyStyleByColumn.price}>Price</th>
      {/if}
      {#if visibleByColumn.amount}
        <th role="columnheader" data-col="amount" class={`text-right tabular-nums ${stickyClassByColumn.amount}`} style={stickyStyleByColumn.amount}>Amount pUSD</th>
      {/if}
      {#if visibleByColumn.time}
        <th role="columnheader" data-col="time" class={`text-right tabular-nums ${stickyClassByColumn.time}`} style={stickyStyleByColumn.time}>Time</th>
      {/if}
      {#if visibleByColumn.tx}
        <th role="columnheader" data-col="tx" class={`text-right tabular-nums ${stickyClassByColumn.tx}`} style={stickyStyleByColumn.tx}>Tx</th>
      {/if}
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
    {#each visibleColumnDefs as column}
      <td data-col={column.id} class={`raw-cell ${column.id === firstVisibleColumn ? 'raw-accent-cell' : ''} ${stickyClassByColumn[column.id]}`} style={stickyStyleByColumn[column.id]}>
        <span class="h-3 w-14 animate-pulse rounded-md bg-muted"></span>
      </td>
    {/each}
  </tr>
{/snippet}
