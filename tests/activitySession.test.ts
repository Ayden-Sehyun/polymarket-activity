import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActivitySession, type ActivitySessionOptions, type ActivitySessionState } from '../src/activitySession'
import type { ActivityPage } from '../src/api'
import { OTHER_WALLET, WALLET, activity } from './fixtures'

const waitFor = async (assertion: () => void | Promise<void>) => {
  const deadline = performance.now() + 1000
  let lastError: unknown
  while (performance.now() < deadline) {
    try {
      await assertion()
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }
  if (lastError) throw lastError
  await assertion()
}

const windowTimers = () => ({
  setInterval: vi.fn(() => 1),
  clearInterval: vi.fn(),
})

const validQuery = (address = WALLET) => ({ address, type: '' as const, side: '' as const, validAddress: true })

describe('activitySession', () => {
  beforeEach(() => {
    vi.stubGlobal('window', windowTimers())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads a 50-row preview and keeps the first historical cursor at offset zero', async () => {
    const preview = Array.from({ length: 50 }, (_, index) => activity(index))
    const states: ActivitySessionState[] = []
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(async () => ({ items: preview }))
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery())

    await waitFor(() => expect(states.at(-1)?.loading).toBe(false))
    expect(states.at(-1)?.rows).toHaveLength(50)
    expect(states.at(-1)?.nextCursor).toEqual({ offset: 0 })
    expect(fetchPage).toHaveBeenCalledWith(WALLET, { type: '', side: '' }, { offset: 0 }, expect.any(AbortSignal), 50)
    session.dispose()
  })

  it('load more appends rows and dedupes the preview boundary', async () => {
    const pages: ActivityPage[] = [
      { items: Array.from({ length: 50 }, (_, index) => activity(index)) },
      { items: [activity(0), activity(50)], nextCursor: { offset: 500 } },
    ]
    const states: ActivitySessionState[] = []
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(async () => pages.shift() ?? { items: [] })
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery())
    await waitFor(() => expect(states.at(-1)?.rows).toHaveLength(50))
    await session.loadNext()

    expect(states.at(-1)?.rows).toHaveLength(51)
    expect(states.at(-1)?.nextCursor).toEqual({ offset: 500 })
    session.dispose()
  })

  it('ignores stale responses after the query changes', async () => {
    const states: ActivitySessionState[] = []
    const pending: Array<{ address: string; resolve: (page: ActivityPage) => void }> = []
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(
      async (address) =>
        new Promise<ActivityPage>((resolve) => {
          pending.push({ address, resolve })
        }),
    )
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery(WALLET))
    await waitFor(() => expect(pending).toHaveLength(1))
    session.setQuery(validQuery(OTHER_WALLET))
    await waitFor(() => expect(pending).toHaveLength(2))

    pending[1].resolve({ items: [activity(2, { proxyWallet: OTHER_WALLET })] })
    await waitFor(() => expect(states.at(-1)?.rows[0]?.proxyWallet).toBe(OTHER_WALLET))
    pending[0].resolve({ items: [activity(1, { proxyWallet: WALLET })] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(states.at(-1)?.rows.map((row) => row.proxyWallet)).toEqual([OTHER_WALLET])
    session.dispose()
  })

  it('retry recovers after an initial failed fetch', async () => {
    const states: ActivitySessionState[] = []
    let fail = true
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(async () => {
      if (fail) throw new Error('failed fetch')
      return { items: [activity(1)] }
    })
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery())
    await waitFor(() => expect(states.at(-1)?.error?.message).toBe('failed fetch'))
    fail = false
    session.retry()
    await waitFor(() => expect(states.at(-1)?.rows).toHaveLength(1))

    expect(states.at(-1)?.error).toBeNull()
    session.dispose()
  })

  it('refreshLatest merges new rows without clearing loaded history or cursor', async () => {
    const pages: ActivityPage[] = [
      { items: Array.from({ length: 50 }, (_, index) => activity(index)) },
      { items: [activity(0), activity(50)], nextCursor: { offset: 500 } },
      { items: [activity(99), activity(0)] },
    ]
    const states: ActivitySessionState[] = []
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(async () => pages.shift() ?? { items: [] })
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery())
    await waitFor(() => expect(states.at(-1)?.rows).toHaveLength(50))
    await session.loadNext()
    await session.refreshLatest()

    expect(states.at(-1)?.rows.map((row) => row.asset)).toContain('asset-99')
    expect(states.at(-1)?.rows.map((row) => row.asset)).toContain('asset-50')
    expect(states.at(-1)?.nextCursor).toEqual({ offset: 500 })
    session.dispose()
  })

  it('auto-fills when client-side filters hide all loaded rows', async () => {
    const pages: ActivityPage[] = [
      { items: Array.from({ length: 50 }, (_, index) => activity(index)) },
      {
        items: [
          activity(999, {
            title: 'Will the highest temperature in Miami be 90°F on June 20?',
            eventSlug: 'weather-miami-90',
          }),
        ],
      },
    ]
    const states: ActivitySessionState[] = []
    const fetchPage = vi.fn<ActivitySessionOptions['fetchPage']>(async () => pages.shift() ?? { items: [] })
    const session = createActivitySession({ fetchPage, onChange: (state) => states.push(state) })

    session.setQuery(validQuery())
    await waitFor(() => expect(states.at(-1)?.rows).toHaveLength(50))
    await session.maybeAutoFillFilteredRows('weather', true, 0)

    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(states.at(-1)?.rows.map((row) => row.eventSlug)).toContain('weather-miami-90')
    expect(states.at(-1)?.autoFilling).toBe(false)
    session.dispose()
  })
})
