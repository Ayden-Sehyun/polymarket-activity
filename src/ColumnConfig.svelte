<script lang="ts">
  import { onMount } from 'svelte'
  import { createEventDispatcher } from 'svelte'
  import type { ColumnId, ColumnLayout, ColumnMenuItem } from './columnState'

  export let columnLayout: ColumnLayout

  const dispatch = createEventDispatcher<{
    toggleSticky: ColumnId
    toggleVisible: ColumnId
  }>()
  const COLUMN_MENU_ITEM_CLASS =
    'flex items-center gap-2 border-b border-hairline px-3 py-2 font-mono text-[11px] uppercase leading-4 last:border-b-0 hover:bg-secondary'
  type ColumnMenuKind = 'sticky' | 'visible'

  let configRow: HTMLDivElement

  onMount(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (configRow?.contains(event.target as Node)) return
      closeMenus()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  })

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

  function toggleColumnMenuItem(kind: ColumnMenuKind, column: ColumnMenuItem) {
    dispatch(kind === 'sticky' ? 'toggleSticky' : 'toggleVisible', column.id)
  }

  function closeMenus() {
    configRow?.querySelectorAll<HTMLDetailsElement>('.column-menu[open]').forEach((details) => {
      details.open = false
    })
  }
</script>

<div bind:this={configRow} data-testid="config-row" class="flex overflow-x-auto border-b border-hairline [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
  {@render ColumnMenu('sticky')}
  {@render ColumnMenu('visible')}
</div>

{#snippet ColumnMenu(kind: ColumnMenuKind)}
  <details class="column-menu relative flex shrink-0 border-r border-hairline" on:toggle={handleColumnMenuToggle}>
    <summary
      data-testid={kind === 'sticky' ? 'sticky-summary' : 'columns-summary'}
      class={`ui-control flex ${kind === 'sticky' ? 'min-w-36' : 'min-w-28'} list-none items-center bg-card pr-3 text-foreground hover:bg-secondary [&::-webkit-details-marker]:hidden`}
    >
      {kind === 'sticky' ? columnLayout.stickySummary : columnLayout.visibleSummary}
    </summary>
    <div
      class="column-menu-panel z-50 grid min-w-48 border border-hairline bg-card shadow-lg"
      data-testid={kind === 'sticky' ? 'sticky-menu' : 'columns-menu'}
    >
      {#each columnLayout.menuItems as column}
        <label class={`${COLUMN_MENU_ITEM_CLASS} ${kind === 'sticky' ? (column.visibleChecked ? 'text-foreground' : 'text-[var(--faint)]') : `text-foreground ${column.visibleDisabled ? 'opacity-50' : ''}`}`}>
          <input
            type="checkbox"
            class="accent-primary"
            checked={kind === 'sticky' ? column.stickyChecked : column.visibleChecked}
            disabled={kind === 'sticky' ? column.stickyDisabled : column.visibleDisabled}
            data-testid={`${kind === 'sticky' ? 'sticky' : 'column'}-${column.id}`}
            on:change={() => toggleColumnMenuItem(kind, column)}
          />
          <span>{column.label}</span>
        </label>
      {/each}
    </div>
  </details>
{/snippet}
