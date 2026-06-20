import { describe, expect, it } from 'vitest'
import {
  formatPriceEquation,
  isPriceSelected,
  reconcilePriceSelection,
  selectedPriceTotal,
  togglePriceSelection,
} from '../src/priceSumSelection'

describe('price sum selection', () => {
  it('toggles selected prices by row key in click order', () => {
    let selection = togglePriceSelection([], 'a', 0.985)
    selection = togglePriceSelection(selection, 'b', 0.01)

    expect(selection).toEqual([
      { key: 'a', price: 0.985 },
      { key: 'b', price: 0.01 },
    ])
    expect(isPriceSelected(selection, 'a')).toBe(true)
    expect(formatPriceEquation(selection)).toBe('0.985 + 0.010 = 0.995')

    selection = togglePriceSelection(selection, 'a', 0.985)
    expect(selection).toEqual([{ key: 'b', price: 0.01 }])
    expect(formatPriceEquation(selection)).toBe('0.010 = 0.010')
  })

  it('ignores non-numeric and zero prices', () => {
    expect(togglePriceSelection([], 'zero', 0)).toEqual([])
    expect(togglePriceSelection([], 'nan', Number.NaN)).toEqual([])
  })

  it('clears the entire selection when any selected key disappears', () => {
    const selection = [
      { key: 'a', price: 0.4 },
      { key: 'b', price: 0.5 },
    ]

    expect(reconcilePriceSelection(selection, ['a', 'b', 'c'])).toBe(selection)
    expect(reconcilePriceSelection(selection, ['a', 'c'])).toEqual([])
  })

  it('totals selected prices with display-time decimal formatting', () => {
    const selection = [
      { key: 'a', price: 0.1 },
      { key: 'b', price: 0.2 },
    ]

    expect(selectedPriceTotal(selection)).toBeCloseTo(0.3)
    expect(formatPriceEquation(selection)).toBe('0.100 + 0.200 = 0.300')
  })
})
