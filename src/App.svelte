<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    fetchActivityPage,
    fetchEventMetadata,
    fetchPusdBalance,
    type Activity,
    type ActivityType,
    type Side,
  } from './api'
  import {
    createActivitySession,
    createInitialActivitySessionState,
    type ActivitySessionState,
  } from './activitySession'
  import {
    createInitialPusdBalanceState,
    createPusdBalanceSession,
    type PusdBalanceState,
  } from './pusdBalanceSession'
  import {
    areCategoriesSettled,
    DEFAULT_CATEGORY,
    filterRows,
    getCategoryOptions,
  } from './category'
  import {
    createCategorySession,
    createInitialCategorySessionState,
    type CategorySessionState,
  } from './categorySession'
  import {
    defaultColumnState,
    getColumnLayout,
    persistColumnState,
    readColumnState,
    toggleStickyColumn as toggleColumnSticky,
    toggleVisibleColumn as toggleColumnVisible,
    type ColumnId,
    type ColumnState,
  } from './columnState'
  import ActivityTable from './ActivityTable.svelte'
  import ColumnConfig from './ColumnConfig.svelte'
  import {
    formatPusdBalance,
    shortHash,
  } from './format'

  const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

  const TYPE_OPTIONS: { value: ActivityType | ''; label: string }[] = [
    { value: '', label: 'All Types' },
    { value: 'TRADE', label: 'Trade' },
    { value: 'REDEEM', label: 'Redeem' },
    { value: 'CONVERSION', label: 'Convert' },
    { value: 'SPLIT', label: 'Split' },
    { value: 'MERGE', label: 'Merge' },
    { value: 'REWARD', label: 'Reward' },
  ]
  const addressFromUrl = () => new URLSearchParams(window.location.search).get('address')?.trim() ?? ''

  let address = addressFromUrl()
  let type: ActivityType | '' = ''
  let side: Side | '' = ''
  let outcome = ''
  let category = DEFAULT_CATEGORY
  let activitySession: ReturnType<typeof createActivitySession> | null = null
  let activityState: ActivitySessionState = createInitialActivitySessionState()
  let balanceSession: ReturnType<typeof createPusdBalanceSession> | null = null
  let pusdBalanceState: PusdBalanceState = createInitialPusdBalanceState()
  let categorySession: ReturnType<typeof createCategorySession> | null = null
  let categoryState: CategorySessionState = createInitialCategorySessionState()
  let columnState: ColumnState = defaultColumnState()
  let stickyOffsets: Partial<Record<ColumnId, number>> = {}
  let showTop = false
  let uiQueryKey = ''
  let now = Date.now()
  let clockTimer: number | undefined
  let parentRef: HTMLDivElement
  let activityTableRef: ActivityTable
  let measureRaf: number | undefined
  let autoFillKey = ''
  let shellWidth = '100%'

  $: validAddress = ADDRESS_RE.test(address)
  $: allRows = activityState.rows
  $: outcomes = [...new Set(allRows.map((row) => row.outcome).filter(Boolean))].sort()
  $: eventCategories = categoryState.categories
  $: categoryOptions = getCategoryOptions(allRows, eventCategories)
  $: rows = filterRows(allRows, outcome, category, eventCategories)
  $: clientFilterActive = Boolean(outcome || category)
  $: categoriesSettled = areCategoriesSettled(allRows, eventCategories)
  $: autoFillKey = `${address.toLowerCase()}|${type}|${side}|${outcome}|${category}`
  $: columnLayout = getColumnLayout(columnState, stickyOffsets)
  $: visibleKey = columnState.visibleColumns.join('|')
  $: stickyKey = columnLayout.activeStickyColumns.join('|')
  $: {
    rows.length
    visibleKey
    stickyKey
    if (!activityState.loading) void scheduleStickyMeasure()
  }
  $: statusText = activityState.lastRefreshAt === null
    ? 'REFRESHING'
    : `${Math.max(0, Math.floor((now - activityState.lastRefreshAt) / 1000))}S SINCE REFRESH`
  $: statusCursor = activityState.nextCursor ? 'more' : validAddress ? 'end' : ''
  $: filteredRowsPending = clientFilterActive && allRows.length > 0 && rows.length === 0 && (!categoriesSettled || activityState.autoFilling)
  $: empty = !activityState.loading && !filteredRowsPending && rows.length === 0
  $: profile = getProfile(allRows)
  $: categorySession?.hydrate(allRows)
  $: if (activitySession) {
    const nextUiQueryKey = `${address.toLowerCase()}|${type}|${side}|${validAddress}`
    if (nextUiQueryKey !== uiQueryKey) {
      uiQueryKey = nextUiQueryKey
      showTop = false
      if (parentRef) parentRef.scrollTop = 0
    }
    activitySession.setQuery({ address, type, side, validAddress })
    balanceSession?.setAddress(address, validAddress)
  }
  $: void activitySession?.maybeAutoFillFilteredRows(autoFillKey, clientFilterActive, rows.length)

  onMount(() => {
    columnState = readColumnState(window.localStorage)
    activitySession = createActivitySession({
      fetchPage: fetchActivityPage,
      onChange: (next) => {
        activityState = next
        if (next.lastRefreshAt !== null) now = next.lastRefreshAt
      },
    })
    balanceSession = createPusdBalanceSession({
      fetchBalance: fetchPusdBalance,
      onChange: (next) => {
        pusdBalanceState = next
      },
    })
    categorySession = createCategorySession({
      fetchEventMetadata,
      onChange: (next) => {
        categoryState = next
      },
    })
    activitySession.setQuery({ address, type, side, validAddress })
    balanceSession.setAddress(address, validAddress)
    categorySession.hydrate(allRows)
    clockTimer = window.setInterval(() => {
      now = Date.now()
    }, 1000)
    window.addEventListener('resize', scheduleStickyMeasure)
    return () => {
      cleanupRuntime()
    }
  })

  function cleanupRuntime() {
    activitySession?.dispose()
    balanceSession?.dispose()
    categorySession?.dispose()
    if (measureRaf !== undefined) window.cancelAnimationFrame(measureRaf)
    if (clockTimer !== undefined) window.clearInterval(clockTimer)
    window.removeEventListener('resize', scheduleStickyMeasure)
  }

  function getProfile(sourceRows: Activity[]) {
    const named = sourceRows.find((row) => row.name || row.pseudonym)
    return {
      name: named?.name || named?.pseudonym || 'Anonymous',
    }
  }

  function toggleStickyColumn(column: ColumnId) {
    columnState = toggleColumnSticky(columnState, column)
    persistColumnState(window.localStorage, columnState)
    void scheduleStickyMeasure()
  }

  function toggleVisibleColumn(column: ColumnId) {
    columnState = toggleColumnVisible(columnState, column)
    persistColumnState(window.localStorage, columnState)
    void scheduleStickyMeasure()
  }

  async function scheduleStickyMeasure() {
    if (activityState.loading || typeof window === 'undefined') return
    if (measureRaf !== undefined) window.cancelAnimationFrame(measureRaf)
    await tick()
    measureRaf = window.requestAnimationFrame(() => {
      measureRaf = undefined
      measureStickyOffsets()
    })
  }

  function measureStickyOffsets() {
    activityTableRef?.measure()
  }

  function handleTableMeasured(event: CustomEvent<{ stickyOffsets: Partial<Record<ColumnId, number>>; shellWidth: string }>) {
    stickyOffsets = event.detail.stickyOffsets
    shellWidth = event.detail.shellWidth
  }

  function handleScroll() {
    showTop = parentRef.scrollTop > 1200
  }

  function retry() {
    activitySession?.retry()
  }

  function backToTop() {
    if (parentRef) parentRef.scrollTop = 0
    showTop = false
  }

</script>

<div class="grid h-[100dvh] min-w-0 grid-rows-[auto_1fr] overflow-hidden bg-[var(--page)] font-mono text-foreground">
  <header class="sticky top-0 z-30 mx-auto border-x border-t border-hairline bg-card" style={`width: ${shellWidth}`}>
    <div class="flex flex-col">
      <div class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {#if validAddress}
          <span class="ui-top-cell flex max-w-52 shrink-0 items-center truncate border-r border-hairline font-semibold text-foreground" data-testid="profile-name">{profile.name}</span>
          <span class="ui-top-cell flex shrink-0 items-center border-r border-hairline font-mono text-muted-foreground">{shortHash(address)}</span>
          <span class="ui-top-cell flex shrink-0 items-center border-r border-hairline font-mono text-[var(--secondary-text)]" data-testid="pusd-balance">
            {#if pusdBalanceState.balance !== null}
              {formatPusdBalance(pusdBalanceState.balance)} PUSD
            {:else if pusdBalanceState.fetching}
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

        <ColumnConfig
          {columnLayout}
          on:toggleSticky={(event) => toggleStickyColumn(event.detail)}
          on:toggleVisible={(event) => toggleVisibleColumn(event.detail)}
        />
      {/if}

      {#if address !== '' && !validAddress}
        <div class="ui-message border-b border-hairline uppercase text-destructive" data-testid="hint">
          <span class="hint">Enter a 0x… address (40 hex chars)</span>
        </div>
      {/if}
    </div>
  </header>

  <main class="mx-auto min-h-0 min-w-0 px-0 pb-0 pt-0 md:px-0" style={`width: ${shellWidth}`}>
    {#if activityState.error}
      <p class="error ui-message flex items-center gap-3 border-x border-b border-red-600 bg-red-950/30 font-mono uppercase text-red-600" data-testid="error">
        <span class="min-w-0 flex-1 break-words">{activityState.error.message}</span>
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
        <ActivityTable
          bind:this={activityTableRef}
          {rows}
          {eventCategories}
          {columnState}
          {stickyOffsets}
          loading={activityState.loading}
          {filteredRowsPending}
          {empty}
          {validAddress}
          nextCursor={Boolean(activityState.nextCursor)}
          fetchingNextPage={activityState.fetchingNextPage}
          fetching={activityState.fetching}
          on:measured={handleTableMeasured}
          on:loadMore={() => activitySession?.loadNext(true)}
        />
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
