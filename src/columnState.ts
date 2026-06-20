import { ACTIVITY_COLUMNS, type ColumnId } from './activityColumns'

export type { ColumnId } from './activityColumns'

export type ColumnState = {
  visibleColumns: ColumnId[]
  stickyColumns: ColumnId[]
}
export type ColumnLayout = {
  visibleByColumn: Record<ColumnId, boolean>
  visibleColumnDefs: typeof ACTIVITY_COLUMNS[number][]
  firstVisibleColumn: ColumnId | undefined
  activeStickyColumns: ColumnId[]
  stickyByColumn: Record<ColumnId, boolean>
  stickyClassByColumn: Record<ColumnId, string>
  stickyStyleByColumn: Record<ColumnId, string>
  headerClassByColumn: Record<ColumnId, string>
  stickySummary: string
  visibleSummary: string
  menuItems: ColumnMenuItem[]
}
export type ColumnMenuItem = {
  id: ColumnId
  label: string
  visibleChecked: boolean
  visibleDisabled: boolean
  stickyChecked: boolean
  stickyDisabled: boolean
}

const STICKY_STORAGE_KEY = 'activity-sticky-columns'
const VISIBLE_STORAGE_KEY = 'activity-visible-columns'
const COLUMN_SCHEMA_STORAGE_KEY = 'activity-column-schema-version'
const CURRENT_COLUMN_SCHEMA_VERSION = '3'
const SCHEMA_ADDED_DEFAULT_VISIBLE_COLUMNS: ColumnId[] = ['shares']
const ALL_COLUMN_IDS = ACTIVITY_COLUMNS.map((column) => column.id)
const DEFAULT_STICKY_COLUMNS: ColumnId[] = ['city', 'temp']

export function defaultColumnState(): ColumnState {
  return {
    visibleColumns: [...ALL_COLUMN_IDS],
    stickyColumns: [...DEFAULT_STICKY_COLUMNS],
  }
}

export function readColumnState(storage: Storage): ColumnState {
  const visibleColumns = migrateVisibleColumns(
    storage,
    readColumnList(storage, VISIBLE_STORAGE_KEY, ALL_COLUMN_IDS, true),
  )
  const stickyColumns = migrateStickyColumns(
    storage,
    readColumnList(storage, STICKY_STORAGE_KEY, DEFAULT_STICKY_COLUMNS).filter((column) => visibleColumns.includes(column)),
    visibleColumns,
  )
  return { visibleColumns, stickyColumns }
}

export function persistColumnState(storage: Storage, state: ColumnState) {
  storage.setItem(VISIBLE_STORAGE_KEY, JSON.stringify(orderColumns(state.visibleColumns)))
  storage.setItem(STICKY_STORAGE_KEY, JSON.stringify(orderColumns(state.stickyColumns)))
  storage.setItem(COLUMN_SCHEMA_STORAGE_KEY, CURRENT_COLUMN_SCHEMA_VERSION)
}

export function toggleStickyColumn(state: ColumnState, column: ColumnId): ColumnState {
  const selected = new Set(state.stickyColumns)
  if (selected.has(column)) selected.delete(column)
  else selected.add(column)
  return {
    visibleColumns: state.visibleColumns,
    stickyColumns: orderColumns([...selected]).filter((id) => state.visibleColumns.includes(id)),
  }
}

export function toggleVisibleColumn(state: ColumnState, column: ColumnId): ColumnState {
  const selected = new Set(state.visibleColumns)
  if (selected.has(column)) {
    if (selected.size === 1) return state
    selected.delete(column)
  } else {
    selected.add(column)
  }

  const visibleColumns = orderColumns([...selected])
  return {
    visibleColumns,
    stickyColumns: state.stickyColumns.filter((id) => visibleColumns.includes(id)),
  }
}

export function getColumnLayout(state: ColumnState, stickyOffsets: Partial<Record<ColumnId, number>>): ColumnLayout {
  const visibleByColumn = booleanByColumn(state.visibleColumns)
  const visibleColumnDefs = ACTIVITY_COLUMNS.filter((column) => visibleByColumn[column.id])
  const firstVisibleColumn = visibleColumnDefs[0]?.id
  const activeStickyColumns = state.stickyColumns.filter((column) => visibleByColumn[column])
  const stickyByColumn = booleanByColumn(activeStickyColumns)
  const stickyClassByColumn = ACTIVITY_COLUMNS.reduce(
    (out, column) => {
      out[column.id] = stickyByColumn[column.id] ? 'raw-sticky-cell' : ''
      return out
    },
    {} as Record<ColumnId, string>,
  )
  const stickyStyleByColumn = ACTIVITY_COLUMNS.reduce(
    (out, column) => {
      out[column.id] = stickyByColumn[column.id] ? `left: ${stickyOffsets[column.id] ?? 0}px` : ''
      return out
    },
    {} as Record<ColumnId, string>,
  )
  const headerClassByColumn = ACTIVITY_COLUMNS.reduce(
    (out, column) => {
      out[column.id] = joinClasses(column.align === 'right' ? 'text-right tabular-nums' : '', stickyClassByColumn[column.id])
      return out
    },
    {} as Record<ColumnId, string>,
  )

  return {
    visibleByColumn,
    visibleColumnDefs,
    firstVisibleColumn,
    activeStickyColumns,
    stickyByColumn,
    stickyClassByColumn,
    stickyStyleByColumn,
    headerClassByColumn,
    stickySummary:
      activeStickyColumns.length === 0
        ? 'STICKY NONE'
        : `STICKY ${activeStickyColumns.map((column) => columnLabel(column)).join(' + ')}`,
    visibleSummary:
      state.visibleColumns.length === ACTIVITY_COLUMNS.length ? 'COLS ALL' : `COLS ${state.visibleColumns.length}/${ACTIVITY_COLUMNS.length}`,
    menuItems: ACTIVITY_COLUMNS.map((column) => ({
      id: column.id,
      label: column.label,
      visibleChecked: visibleByColumn[column.id],
      visibleDisabled: state.visibleColumns.length === 1 && visibleByColumn[column.id],
      stickyChecked: stickyByColumn[column.id],
      stickyDisabled: !visibleByColumn[column.id],
    })),
  }
}

export function measureStickyOffsets(table: HTMLTableElement | undefined, stickyByColumn: Record<ColumnId, boolean>) {
  if (!table) return {}
  let left = 0
  const next: Partial<Record<ColumnId, number>> = {}
  for (const column of ACTIVITY_COLUMNS) {
    if (!stickyByColumn[column.id]) continue
    next[column.id] = left
    const header = table.querySelector<HTMLElement>(`[data-col="${column.id}"]`)
    left += header?.getBoundingClientRect().width ?? 0
  }
  return next
}

function readColumnList(storage: Storage, key: string, fallback: ColumnId[], requireOne = false) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return [...fallback]
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return [...fallback]
    const valid = parsed.filter((value): value is ColumnId => ALL_COLUMN_IDS.includes(value as ColumnId))
    return valid.length > 0 || !requireOne ? orderColumns(valid) : [...fallback]
  } catch {
    return [...fallback]
  }
}

function migrateVisibleColumns(storage: Storage, columns: ColumnId[]) {
  if (storage.getItem(COLUMN_SCHEMA_STORAGE_KEY) === CURRENT_COLUMN_SCHEMA_VERSION) return columns
  return orderColumns([...columns, ...SCHEMA_ADDED_DEFAULT_VISIBLE_COLUMNS])
}

function migrateStickyColumns(storage: Storage, columns: ColumnId[], visibleColumns: ColumnId[]) {
  if (storage.getItem(COLUMN_SCHEMA_STORAGE_KEY) === CURRENT_COLUMN_SCHEMA_VERSION) return columns
  return orderColumns([...columns, 'temp']).filter((column) => visibleColumns.includes(column))
}

function orderColumns(columns: ColumnId[]) {
  const selected = new Set(columns)
  return ALL_COLUMN_IDS.filter((id) => selected.has(id))
}

function booleanByColumn(columns: ColumnId[]) {
  const selected = new Set(columns)
  return ACTIVITY_COLUMNS.reduce(
    (out, column) => {
      out[column.id] = selected.has(column.id)
      return out
    },
    {} as Record<ColumnId, boolean>,
  )
}

function columnLabel(column: ColumnId) {
  return ACTIVITY_COLUMNS.find((def) => def.id === column)?.label.toUpperCase() ?? column.toUpperCase()
}

function joinClasses(...classes: string[]) {
  return classes.filter(Boolean).join(' ')
}
