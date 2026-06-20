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
  import { formatDecimal, outcomeClass, sideClass } from './format'

  export let rows: Activity[] = []
  export let eventCategories: CategoryMap = {}
  export let columnState: ColumnState
  export let stickyOffsets: Partial<Record<ColumnId, number>> = {}
  export let loading = false
  export let filteredRowsPending = false
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
  $: visibleByColumn = columnLayout.visibleByColumn
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

{#if !loading && !filteredRowsPending && validAddress && nextCursor}
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
  {#if visibleByColumn.city}
    <td role="cell" data-col="city" class={`raw-cell font-mono text-foreground ${firstVisibleColumn === 'city' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.city}`} style={stickyStyleByColumn.city} title={row.title}>
      {row.city}
    </td>
  {/if}
  {#if visibleByColumn.temp}
    <td role="cell" data-col="temp" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'temp' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.temp}`} style={stickyStyleByColumn.temp} title={row.title}>
      {row.temp}
    </td>
  {/if}
  {#if visibleByColumn.date}
    <td role="cell" data-col="date" class={`raw-cell justify-end font-mono text-right tabular-nums text-[var(--secondary-text)] ${firstVisibleColumn === 'date' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.date}`} style={stickyStyleByColumn.date} title={row.title}>
      {row.date}
    </td>
  {/if}
  {#if visibleByColumn.side}
    <td role="cell" data-col="side" class={`raw-cell font-mono font-semibold ${sideClass(row.source.side)} ${firstVisibleColumn === 'side' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.side}`} style={stickyStyleByColumn.side} title={row.source.side}>
      {row.sideLabel}
    </td>
  {/if}
  {#if visibleByColumn.type}
    <td role="cell" data-col="type" data-testid="cell-type" class={`raw-cell font-mono text-foreground ${firstVisibleColumn === 'type' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.type}`} style={stickyStyleByColumn.type} title={row.typeLabel}>
      {row.typeLabel}
    </td>
  {/if}
  {#if visibleByColumn.outcome}
    <td role="cell" data-col="outcome" class={`raw-cell font-mono font-semibold ${outcomeClass(row.outcome)} ${firstVisibleColumn === 'outcome' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.outcome}`} style={stickyStyleByColumn.outcome} title={row.outcome}>
      {row.outcome}
    </td>
  {/if}
  {#if visibleByColumn.price}
    <td role="cell" data-col="price" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'price' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.price}`} style={stickyStyleByColumn.price} title={String(row.price)}>
      {#if row.source.type === 'TRADE' && row.price > 0}
        {@render DecimalNumber(row.price, 3)}
      {:else}
        <span class="text-[var(--faint)]">--</span>
      {/if}
    </td>
  {/if}
  {#if visibleByColumn.shares}
    <td role="cell" data-col="shares" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'shares' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.shares}`} style={stickyStyleByColumn.shares} title={String(row.shares)}>
      {@render DecimalNumber(row.shares, 5)}
    </td>
  {/if}
  {#if visibleByColumn.amount}
    <td role="cell" data-col="amount" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'amount' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.amount}`} style={stickyStyleByColumn.amount} title={String(row.amount)}>
      {@render DecimalNumber(row.amount, 5)}
    </td>
  {/if}
  {#if visibleByColumn.time}
    <td role="cell" data-col="time" class={`raw-cell justify-end font-mono text-right tabular-nums text-foreground ${firstVisibleColumn === 'time' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.time}`} style={stickyStyleByColumn.time} title={String(row.source.timestamp)}>
      {row.time}
    </td>
  {/if}
  {#if visibleByColumn.tx}
    <td role="cell" data-col="tx" class={`raw-cell justify-end font-mono text-right text-foreground ${firstVisibleColumn === 'tx' ? 'raw-accent-cell' : ''} ${stickyClassByColumn.tx}`} style={stickyStyleByColumn.tx} title={row.txHash}>
      <a
        href={row.txHref}
        target="_blank"
        rel="noreferrer"
        title={row.txHash}
        class="raw-link-anchor text-[var(--faint)] hover:bg-secondary hover:text-[var(--brand)]"
      >
        LINK
      </a>
    </td>
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
