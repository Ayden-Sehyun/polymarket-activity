import type { ActivityDisplayRow } from './displayRow'
import { outcomeClass, sideClass } from './format'

type CellAlign = 'left' | 'right'

export type ActivityColumn = {
  id: string
  label: string
  align: CellAlign
  cellClass: (row: ActivityDisplayRow) => string
  title: (row: ActivityDisplayRow) => string
}

const text = 'font-mono text-foreground'
const numeric = 'justify-end font-mono text-right tabular-nums text-foreground'
const mutedNumeric = 'justify-end font-mono text-right tabular-nums text-[var(--secondary-text)]'

export const ACTIVITY_COLUMNS = [
  {
    id: 'city',
    label: 'City',
    align: 'left',
    cellClass: () => text,
    title: (row) => row.title,
  },
  {
    id: 'temp',
    label: 'Temp',
    align: 'right',
    cellClass: () => numeric,
    title: (row) => row.title,
  },
  {
    id: 'date',
    label: 'Date',
    align: 'right',
    cellClass: () => mutedNumeric,
    title: (row) => row.title,
  },
  {
    id: 'side',
    label: 'Side',
    align: 'left',
    cellClass: (row) => `font-mono font-semibold ${sideClass(row.source.side)}`,
    title: (row) => row.source.side,
  },
  {
    id: 'type',
    label: 'Type',
    align: 'left',
    cellClass: () => text,
    title: (row) => row.typeLabel,
  },
  {
    id: 'outcome',
    label: 'Outcome',
    align: 'left',
    cellClass: (row) => `font-mono font-semibold ${outcomeClass(row.outcome)}`,
    title: (row) => row.outcome,
  },
  {
    id: 'price',
    label: 'Price',
    align: 'right',
    cellClass: () => numeric,
    title: (row) => String(row.price),
  },
  {
    id: 'shares',
    label: 'Shares',
    align: 'right',
    cellClass: () => numeric,
    title: (row) => String(row.shares),
  },
  {
    id: 'amount',
    label: 'Amount pUSD',
    align: 'right',
    cellClass: () => numeric,
    title: (row) => String(row.amount),
  },
  {
    id: 'time',
    label: 'Time',
    align: 'right',
    cellClass: () => numeric,
    title: (row) => String(row.source.timestamp),
  },
  {
    id: 'tx',
    label: 'Tx',
    align: 'left',
    cellClass: () => 'font-mono text-foreground',
    title: (row) => row.txHash,
  },
] satisfies ActivityColumn[]

export type ColumnId = (typeof ACTIVITY_COLUMNS)[number]['id']
