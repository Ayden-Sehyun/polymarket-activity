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

export interface EventTag {
  label: string
  slug: string
}

export interface EventMetadata {
  slug: string
  category: string | null
  tags: EventTag[]
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
export const INITIAL_PAGE_SIZE = 50
/** data-api rejects offsets beyond 3000 ("max historical activity offset of 3000 exceeded") */
const MAX_OFFSET = 3000

const BASE = 'https://data-api.polymarket.com/activity'
const GAMMA_EVENT_BASE = 'https://gamma-api.polymarket.com/events/slug'
const PUSD_TOKEN = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB'
const PUSD_DECIMALS = 6
const POLYGON_RPC_URLS = [
  'https://polygon.drpc.org',
  'https://1rpc.io/matic',
  'https://polygon-bor-rpc.publicnode.com',
]

export async function fetchActivityPage(
  address: string,
  filters: ActivityFilters,
  cursor: Cursor,
  signal?: AbortSignal,
  pageSize = PAGE_SIZE,
): Promise<ActivityPage> {
  const params = new URLSearchParams({
    user: address,
    limit: String(pageSize),
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
  if (items.length === pageSize) {
    const nextOffset = cursor.offset + pageSize
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

export async function fetchEventMetadata(eventSlug: string, signal?: AbortSignal): Promise<EventMetadata> {
  const res = await fetch(`${GAMMA_EVENT_BASE}/${encodeURIComponent(eventSlug)}`, { signal })
  if (!res.ok) throw new Error(`gamma ${res.status}: ${await res.text()}`)
  const event = (await res.json()) as Partial<EventMetadata>
  return {
    slug: event.slug ?? eventSlug,
    category: event.category ?? null,
    tags: Array.isArray(event.tags) ? event.tags.filter((tag): tag is EventTag => Boolean(tag.label && tag.slug)) : [],
  }
}

export async function fetchPusdBalance(address: string, signal?: AbortSignal): Promise<number> {
  const data = `0x70a08231${address.slice(2).padStart(64, '0')}`
  const payload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_call',
    params: [{ to: PUSD_TOKEN, data }, 'latest'],
  }

  let lastError: Error | null = null
  for (const url of POLYGON_RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      })
      const json = (await res.json()) as { result?: string; error?: { message?: string } }
      if (!res.ok || json.error || !json.result) {
        throw new Error(json.error?.message || `rpc ${res.status}`)
      }
      return Number(BigInt(json.result)) / 10 ** PUSD_DECIMALS
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('pUSD balance unavailable')
}
