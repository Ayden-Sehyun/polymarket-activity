import type { Activity } from './api'
import type { CategoryMap } from './category'
import { cityLabel, compactWeatherTitle, displayType, formatTimeShort, txHref } from './format'

export type ActivityDisplayRow = {
  source: Activity
  categoryValue: string
  title: string
  city: string
  temp: string
  date: string
  sideLabel: string
  typeLabel: string
  outcome: string
  price: number
  shares: number
  amount: number
  time: string
  txHref: string
  txHash: string
}

export function toActivityDisplayRow(row: Activity, categories: CategoryMap): ActivityDisplayRow {
  const titleParts = compactWeatherTitle(row.title)
  return {
    source: row,
    categoryValue: categories[row.eventSlug]?.value ?? '',
    title: row.title,
    city: cityLabel(row),
    temp: titleParts ? `${titleParts.temp}${titleParts.low ? ' low' : ''}` : '--',
    date: titleParts?.date ?? '--',
    sideLabel: row.side === 'BUY' ? 'Buy' : row.side === 'SELL' ? 'Sell' : '',
    typeLabel: displayType(row.type),
    outcome: row.outcome,
    price: row.price,
    shares: row.size,
    amount: row.usdcSize,
    time: formatTimeShort(row.timestamp),
    txHref: txHref(row.transactionHash),
    txHash: row.transactionHash,
  }
}
