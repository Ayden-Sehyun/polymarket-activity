import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCategorySession, type CategorySessionState } from '../src/categorySession'
import { activity } from './fixtures'

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

describe('categorySession', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hydrates slug-inferred categories without metadata fetches', () => {
    const states: CategorySessionState[] = []
    const fetchEventMetadata = vi.fn()
    const session = createCategorySession({ fetchEventMetadata, onChange: (state) => states.push(state) })

    session.hydrate([
      activity(1, {
        title: 'Will the highest temperature in Miami be 90°F on June 20?',
        eventSlug: 'weather-miami-90',
      }),
    ])

    expect(states.at(-1)?.categories).toEqual({
      'weather-miami-90': { value: 'weather', label: 'Weather' },
    })
    expect(fetchEventMetadata).not.toHaveBeenCalled()
    session.dispose()
  })

  it('fetches metadata for unknown slugs and records null on failure', async () => {
    const states: CategorySessionState[] = []
    const fetchEventMetadata = vi
      .fn()
      .mockResolvedValueOnce({ slug: 'unknown-one', category: null, tags: [{ label: 'NBA', slug: 'nba' }] })
      .mockRejectedValueOnce(new Error('gamma failed'))
    const session = createCategorySession({
      fetchEventMetadata,
      onChange: (state) => states.push(state),
      concurrency: 1,
    })

    session.hydrate([
      activity(1, { title: 'Unclassified one?', slug: 'unknown-one', eventSlug: 'unknown-one' }),
      activity(2, { title: 'Unclassified two?', slug: 'unknown-two', eventSlug: 'unknown-two' }),
    ])

    await waitFor(() =>
      expect(states.at(-1)?.categories).toEqual({
        'unknown-one': { value: 'sports', label: 'Sports' },
        'unknown-two': null,
      }),
    )
    session.dispose()
  })

  it('dedupes pending metadata fetches and suppresses queued work after dispose', async () => {
    const states: CategorySessionState[] = []
    let resolveMetadata: (value: { slug: string; category: string; tags: [] }) => void = () => {}
    const fetchEventMetadata = vi.fn(
      async (_slug: string) =>
        new Promise<{ slug: string; category: string; tags: [] }>((resolve) => {
          resolveMetadata = resolve
        }),
    )
    const session = createCategorySession({
      fetchEventMetadata,
      onChange: (state) => states.push(state),
      concurrency: 1,
    })
    const row = activity(1, { title: 'Unclassified?', slug: 'unknown-one', eventSlug: 'unknown-one' })
    const queuedRow = activity(2, { title: 'Unclassified second?', slug: 'unknown-two', eventSlug: 'unknown-two' })

    session.hydrate([row, row, queuedRow])
    session.hydrate([row])
    expect(fetchEventMetadata).toHaveBeenCalledTimes(1)

    const emissionsBeforeDispose = states.length
    session.dispose()
    resolveMetadata({ slug: 'unknown-one', category: 'finance', tags: [] })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(states).toHaveLength(emissionsBeforeDispose)
    expect(fetchEventMetadata).toHaveBeenCalledTimes(1)
  })
})
