import { formatDecimalText } from './format'

export const PRICE_SUM_DECIMALS = 3

export type PriceSelectionItem = {
  key: string
  price: number
}

export function isSelectablePrice(price: number) {
  return Number.isFinite(price) && price > 0
}

export function isPriceSelected(selection: PriceSelectionItem[], key: string) {
  return selection.some((item) => item.key === key)
}

export function togglePriceSelection(selection: PriceSelectionItem[], key: string, price: number) {
  if (!isSelectablePrice(price)) return selection
  return isPriceSelected(selection, key) ? selection.filter((item) => item.key !== key) : [...selection, { key, price }]
}

export function reconcilePriceSelection(selection: PriceSelectionItem[], liveKeys: Iterable<string>) {
  if (selection.length === 0) return selection
  const live = new Set(liveKeys)
  return selection.every((item) => live.has(item.key)) ? selection : []
}

export function selectedPriceTotal(selection: PriceSelectionItem[]) {
  return selection.reduce((sum, item) => sum + item.price, 0)
}

export function formatPriceEquation(selection: PriceSelectionItem[]) {
  if (selection.length === 0) return ''
  const terms = selection.map((item) => formatDecimalText(item.price, PRICE_SUM_DECIMALS))
  const total = formatDecimalText(selectedPriceTotal(selection), PRICE_SUM_DECIMALS)
  return `${terms.join(' + ')} = ${total}`
}
