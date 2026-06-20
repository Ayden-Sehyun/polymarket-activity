import { describe, expect, it } from 'vitest'
import {
  defaultColumnState,
  getColumnLayout,
  persistColumnState,
  readColumnState,
  toggleStickyColumn,
  toggleVisibleColumn,
  type ColumnState,
} from '../src/columnState'
import { memoryStorage } from './fixtures'

describe('columnState', () => {
  it('reads persisted columns in canonical order and drops unknown/stale ids', () => {
    const storage = memoryStorage({
      'activity-visible-columns': JSON.stringify(['tx', 'nope', 'city']),
      'activity-sticky-columns': JSON.stringify(['price', 'city', 'nope']),
      'activity-column-schema-version': '2',
    })

    expect(readColumnState(storage)).toEqual({
      visibleColumns: ['city', 'tx'],
      stickyColumns: ['city'],
    })
  })

  it('round-trips visible and sticky state through storage', () => {
    const storage = memoryStorage()
    const state: ColumnState = {
      visibleColumns: ['city', 'temp', 'shares', 'amount'],
      stickyColumns: ['city', 'temp'],
    }

    persistColumnState(storage, state)

    expect(readColumnState(storage)).toEqual(state)
    expect(storage.getItem('activity-column-schema-version')).toBe('2')
  })

  it('adds new default-visible columns when reading old saved column state', () => {
    const storage = memoryStorage({
      'activity-visible-columns': JSON.stringify(['city', 'temp', 'amount']),
      'activity-sticky-columns': JSON.stringify(['city']),
    })

    expect(readColumnState(storage)).toEqual({
      visibleColumns: ['city', 'temp', 'shares', 'amount'],
      stickyColumns: ['city'],
    })
  })

  it('keeps one visible column and removes sticky state when a column is hidden', () => {
    const oneColumn: ColumnState = { visibleColumns: ['city'], stickyColumns: ['city'] }
    expect(toggleVisibleColumn(oneColumn, 'city')).toEqual(oneColumn)

    const state = toggleVisibleColumn(
      { visibleColumns: ['city', 'temp', 'date'], stickyColumns: ['city', 'temp'] },
      'city',
    )

    expect(state).toEqual({
      visibleColumns: ['temp', 'date'],
      stickyColumns: ['temp'],
    })
  })

  it('derives summaries, checkbox state, and sticky styles from one interface', () => {
    const state = toggleStickyColumn(toggleStickyColumn(defaultColumnState(), 'temp'), 'date')
    const layout = getColumnLayout(state, { city: 0, temp: 128, date: 220 })

    expect(layout.stickySummary).toBe('Sticky: City + Temp + Date')
    expect(layout.visibleSummary).toBe('Cols: All')
    expect(layout.stickyClassByColumn.temp).toBe('raw-sticky-cell')
    expect(layout.headerClassByColumn.city).toBe('raw-sticky-cell')
    expect(layout.headerClassByColumn.temp).toBe('text-right tabular-nums raw-sticky-cell')
    expect(layout.headerClassByColumn.shares).toBe('text-right tabular-nums')
    expect(layout.headerClassByColumn.price).toBe('text-right tabular-nums')
    expect(layout.stickyStyleByColumn.date).toBe('left: 220px')
    expect(layout.menuItems.find((item) => item.id === 'city')).toMatchObject({
      visibleChecked: true,
      visibleDisabled: false,
      stickyChecked: true,
      stickyDisabled: false,
    })
  })
})
