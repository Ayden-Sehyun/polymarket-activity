import type { Activity } from '../src/api'

export const WALLET = '0x774728ed9264a5ca242e8bd7952a869df318fe40'
export const OTHER_WALLET = '0x0c7c5204404e9d5402d258fedac59c7212bae4cb'

export function activity(index: number, overrides: Partial<Activity> = {}): Activity {
  return {
    proxyWallet: WALLET,
    timestamp: 1_781_900_000 - index,
    conditionId: `condition-${index}`,
    type: 'TRADE',
    size: 1,
    usdcSize: 0.01,
    transactionHash: `0x${index.toString(16).padStart(64, '0')}`,
    price: 0.1,
    asset: `asset-${index}`,
    side: 'BUY',
    outcomeIndex: 0,
    title: 'Will Alice win the 2028 presidential election?',
    slug: `mock-politics-${index}`,
    icon: '',
    eventSlug: `mock-politics-${index}`,
    outcome: 'Yes',
    name: 'Mock',
    pseudonym: 'Mock',
    ...overrides,
  }
}

export function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial))
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return [...values.keys()][index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}
