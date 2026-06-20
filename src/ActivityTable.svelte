<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  import { activityKey, type Activity } from './api'
  import type { CategoryMap } from './category'
  import { toActivityDisplayRow, type ActivityDisplayRow } from './displayRow'
  import {
    getColumnLayout,
    measureStickyOffsets as measureColumnStickyOffsets,
    type ColumnId,
    type ColumnState,
  } from './columnState'
  import { formatDecimal } from './format'

  export let rows: Activity[] = []
  export let eventCategories: CategoryMap = {}
  export let columnState: ColumnState
  export let stickyOffsets: Partial<Record<ColumnId, number>> = {}
  export let loading = false
  export let empty = false
  export let validAddress = false
  export let nextCursor = false
  export let fetchingNextPage = false
  export let fetching = false

  const dispatch = createEventDispatcher<{
    loadMore: void
    measured: {
      stickyOffsets: Partial<Record<ColumnId, number>>
      shellWidth: string
    }
  }>()

  let tableRef: HTMLTableElement

  $: columnLayout = getColumnLayout(columnState, stickyOffsets)
  $: visibleColumnDefs = columnLayout.visibleColumnDefs
  $: firstVisibleColumn = columnLayout.firstVisibleColumn
  $: stickyClassByColumn = columnLayout.stickyClassByColumn
  $: stickyStyleByColumn = columnLayout.stickyStyleByColumn
  $: headerClassByColumn = columnLayout.headerClassByColumn

  export function measure(viewportWidth = typeof window === 'undefined' ? 0 : window.innerWidth) {
    const nextStickyOffsets = measureColumnStickyOffsets(tableRef, columnLayout.stickyByColumn)
    const tableWidth = tableRef ? Math.ceil(tableRef.scrollWidth) : viewportWidth
    const shellWidth = `${Math.min(tableWidth, viewportWidth)}px`
    dispatch('measured', { stickyOffsets: nextStickyOffsets, shellWidth })
  }
</script>

{#if loading}
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
        {@const displayRow = toActivityDisplayRow(row, eventCategories)}
        <tr
          data-testid="raw-row"
          data-category={displayRow.categoryValue}
          data-index={index}
          class="raw-row group"
          style={`--row-accent: ${displayRow.accent}`}
        >
          {@render RawCells(displayRow)}
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
      on:click={() => dispatch('loadMore')}
    >
      {fetchingNextPage ? 'Loading more...' : 'Load more'}
    </button>
  </div>
{/if}

{#snippet RawHeader()}
  <thead class="raw-head" data-testid="raw-header">
    <tr>
      {#each visibleColumnDefs as column}
        <th role="columnheader" data-col={column.id} class={headerClassByColumn[column.id]} style={stickyStyleByColumn[column.id]}>{column.label}</th>
      {/each}
    </tr>
  </thead>
{/snippet}

{#snippet RawCells(row: ActivityDisplayRow)}
  {#each visibleColumnDefs as column}
    <td
      role="cell"
      data-col={column.id}
      data-testid={column.id === 'type' ? 'cell-type' : undefined}
      class={`raw-cell ${column.cellClass(row)} ${firstVisibleColumn === column.id ? 'raw-accent-cell' : ''} ${stickyClassByColumn[column.id]}`}
      style={stickyStyleByColumn[column.id]}
      title={column.title(row)}
    >
      {@render CellContent(column.id, row)}
    </td>
  {/each}
{/snippet}

{#snippet CellContent(columnId: ColumnId, row: ActivityDisplayRow)}
  {#if columnId === 'city'}
    {row.city}
  {:else if columnId === 'temp'}
    {row.temp}
  {:else if columnId === 'date'}
    {row.date}
  {:else if columnId === 'side'}
    {row.sideLabel}
  {:else if columnId === 'type'}
    {row.typeLabel}
  {:else if columnId === 'outcome'}
    {row.outcome}
  {:else if columnId === 'price'}
    {#if row.source.type === 'TRADE' && row.price > 0}
      {@render DecimalNumber(row.price, 3)}
    {:else}
      <span class="text-[var(--faint)]">--</span>
    {/if}
  {:else if columnId === 'shares'}
    {@render DecimalNumber(row.shares, 5)}
  {:else if columnId === 'amount'}
    {@render DecimalNumber(row.amount, 5)}
  {:else if columnId === 'time'}
    {row.time}
  {:else if columnId === 'tx'}
    <a
      href={row.txHref}
      target="_blank"
      rel="noreferrer"
      title={row.txHash}
      class="raw-link-anchor text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
    >
      LINK
    </a>
  {/if}
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
