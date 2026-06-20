<script lang="ts">
  import { onMount, tick } from 'svelte'
  import {
    activityKey,
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
    categoryForRow,
    categoryFromActivity,
    categoryFromMetadata,
    DEFAULT_CATEGORY,
    filterRows,
    getCategoryOptions,
    type CategoryOption,
  } from './category'
  import {
    defaultColumnState,
    getColumnLayout,
    measureStickyOffsets as measureColumnStickyOffsets,
    persistColumnState,
    readColumnState,
    toggleStickyColumn as toggleColumnSticky,
    toggleVisibleColumn as toggleColumnVisible,
    type ColumnId,
    type ColumnState,
  } from './columnState'
  import {
    cityLabel,
    compactWeatherTitle,
    displayType,
    formatDecimal,
    formatPusdBalance,
    formatTimeShort,
    outcomeClass,
    rawEventAccent,
    shortHash,
    sideClass,
    txHref,
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
  const CATEGORY_FETCH_CONCURRENCY = 6

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
  let columnState: ColumnState = defaultColumnState()
  let stickyOffsets: Partial<Record<ColumnId, number>> = {}
  let eventCategories: Record<string, CategoryOption | null> = {}
  let showTop = false
  let uiQueryKey = ''
  let now = Date.now()
  let clockTimer: number | undefined
  let categoryController: AbortController | null = null
  let parentRef: HTMLDivElement
  let tableRef: HTMLTableElement
  let measureRaf: number | undefined
  let pendingCategorySlugs = new Set<string>()
  let autoFillKey = ''

  $: validAddress = ADDRESS_RE.test(address)
  $: allRows = activityState.rows
  $: outcomes = [...new Set(allRows.map((row) => row.outcome).filter(Boolean))].sort()
  $: categoryOptions = getCategoryOptions(allRows, eventCategories)
  $: rows = filterRows(allRows, outcome, category, eventCategories)
  $: clientFilterActive = Boolean(outcome || category)
  $: categoriesSettled = areCategoriesSettled(allRows, eventCategories)
  $: autoFillKey = `${address.toLowerCase()}|${type}|${side}|${outcome}|${category}`
  $: columnLayout = getColumnLayout(columnState, stickyOffsets)
  $: visibleByColumn = columnLayout.visibleByColumn
  $: visibleColumnDefs = columnLayout.visibleColumnDefs
  $: firstVisibleColumn = columnLayout.firstVisibleColumn
  $: stickyClassByColumn = columnLayout.stickyClassByColumn
  $: stickyStyleByColumn = columnLayout.stickyStyleByColumn
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
  $: void hydrateEventCategories(allRows)
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
    activitySession.setQuery({ address, type, side, validAddress })
    balanceSession.setAddress(address, validAddress)
    clockTimer = window.setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => {
      cleanupRuntime()
    }
  })

  function cleanupRuntime() {
    activitySession?.dispose()
    balanceSession?.dispose()
    categoryController?.abort()
    if (measureRaf !== undefined) window.cancelAnimationFrame(measureRaf)
    if (clockTimer !== undefined) window.clearInterval(clockTimer)
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
    stickyOffsets = measureColumnStickyOffsets(tableRef, columnLayout.stickyByColumn)
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
  <header class="sticky top-0 z-30 border-x border-t border-hairline bg-card md:mx-auto md:w-full md:max-w-[1100px]">
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

        <div data-testid="config-row" class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <details class="column-menu relative flex shrink-0 border-r border-hairline" on:toggle={handleColumnMenuToggle}>
            <summary
              data-testid="sticky-summary"
              class="ui-control flex min-w-36 cursor-pointer list-none items-center bg-card pr-3 text-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden"
            >
              {columnLayout.stickySummary}
            </summary>
            <div class="column-menu-panel z-50 grid min-w-48 border border-hairline bg-card shadow-lg" data-testid="sticky-menu">
              {#each columnLayout.menuItems as column}
                <label class={`flex cursor-pointer items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[11px] uppercase leading-4 last:border-b-0 hover:bg-secondary ${column.visibleChecked ? 'text-foreground' : 'text-[var(--faint)]'}`}>
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={column.stickyChecked}
                    disabled={column.stickyDisabled}
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
              {columnLayout.visibleSummary}
            </summary>
            <div class="column-menu-panel z-50 grid min-w-48 border border-hairline bg-card shadow-lg" data-testid="columns-menu">
              {#each columnLayout.menuItems as column}
                <label class={`flex cursor-pointer items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[11px] uppercase leading-4 text-foreground last:border-b-0 hover:bg-secondary ${column.visibleDisabled ? 'opacity-50' : ''}`}>
                  <input
                    type="checkbox"
                    class="accent-primary"
                    checked={column.visibleChecked}
                    disabled={column.visibleDisabled}
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
        {#if activityState.loading || filteredRowsPending}
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

        {#if !activityState.loading && rows.length > 0}
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
                    <td role="cell" data-col="side" class={`raw-cell font-mono font-semibold ${sideClass(row.side)} ${firstVisibleColumn === 'side' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.side}`} style={stickyStyleByColumn.side} title={row.side}>
                      {row.side === 'BUY' ? 'Buy' : row.side === 'SELL' ? 'Sell' : ''}
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

        {#if !activityState.loading && !filteredRowsPending && validAddress && activityState.nextCursor}
          <div class="ui-message grid place-items-center border-t border-hairline py-4 text-muted-foreground">
            <button
              type="button"
              data-testid="load-more"
              class="ui-action border border-hairline bg-card text-foreground hover:bg-secondary disabled:cursor-wait disabled:text-muted-foreground"
              disabled={activityState.fetchingNextPage || activityState.fetching}
              on:click={() => activitySession?.loadNext(true)}
            >
              {activityState.fetchingNextPage ? 'Loading more...' : 'Load more'}
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
