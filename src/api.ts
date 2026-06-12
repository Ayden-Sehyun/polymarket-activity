export type ActivityType = 'TRADE' | 'SPLIT' | 'MERGE' | 'REDEEM' | 'REWARD' | 'CONVERSION'
export type Side = 'BUY' | 'SELL'

export interface Activity {
  proxyWallet: string
  timestamp: number
  conditionId: string
  type: ActivityType
  size: number
  usdcSize: number
  transactionHash: string
  price: number
  asset: string
  side: Side | ''
  outcomeIndex: number
  title: string
  slug: string
  icon: string
  eventSlug: string
  outcome: string
  name: string
  pseudonym: string
}

export interface ActivityFilters {
  type?: ActivityType | ''
  side?: Side | ''
}

export interface Cursor {
  offset: number
  /** unix seconds, inclusive upper bound; used to window past the offset cap */
  end?: number
}

export interface ActivityPage {
  items: Activity[]
  nextCursor?: Cursor
}

export const PAGE_SIZE = 500
/** data-api rejects offsets beyond 3000 ("max historical activity offset of 3000 exceeded") */
const MAX_OFFSET = 3000

const BASE = 'https://data-api.polymarket.com/activity'

export async function fetchActivityPage(
  address: string,
  filters: ActivityFilters,
  cursor: Cursor,
  signal?: AbortSignal,
): Promise<ActivityPage> {
  const params = new URLSearchParams({
    user: address,
    limit: String(PAGE_SIZE),
    offset: String(cursor.offset),
    sortDirection: 'DESC',
  })
  if (cursor.end !== undefined) params.set('end', String(cursor.end))
  if (filters.type) params.set('type', filters.type)
  if (filters.side) params.set('side', filters.side)

  const res = await fetch(`${BASE}?${params}`, { signal })
  if (!res.ok) throw new Error(`data-api ${res.status}: ${await res.text()}`)
  const items = (await res.json()) as Activity[]

  let nextCursor: Cursor | undefined
  if (items.length === PAGE_SIZE) {
    const nextOffset = cursor.offset + PAGE_SIZE
    nextCursor =
      nextOffset > MAX_OFFSET
        ? // restart the window at the oldest timestamp seen; `end` is inclusive,
          // so boundary rows repeat and are dropped by activityKey dedup
          { offset: 0, end: items[items.length - 1].timestamp }
        : { offset: nextOffset, end: cursor.end }
  }
  return { items, nextCursor }
}

/** Rows can repeat at time-window boundaries; this key is unique enough to drop them. */
export function activityKey(a: Activity): string {
  return [a.transactionHash, a.type, a.asset, a.side, a.outcomeIndex, a.size, a.timestamp].join('|')
}
