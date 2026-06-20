import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACTIVITY_OPTIONS,
  patchActivityOptions,
  persistActivityOptions,
  readActivityOptions,
  type ActivityOptions,
} from '../src/activityOptions'
import { memoryStorage } from './fixtures'

describe('activityOptions storage', () => {
  it('falls back to defaults for missing, malformed, or invalid values', () => {
    expect(readActivityOptions(memoryStorage())).toEqual(DEFAULT_ACTIVITY_OPTIONS)
    expect(readActivityOptions(memoryStorage({ 'activity-options': '{' }))).toEqual(DEFAULT_ACTIVITY_OPTIONS)
    expect(
      readActivityOptions(
        memoryStorage({
          'activity-options': JSON.stringify({
            type: 'BAD',
            side: 'MAYBE',
            outcome: 1,
            category: ['weather'],
            autoRefreshMs: '999',
          }),
        }),
      ),
    ).toEqual(DEFAULT_ACTIVITY_OPTIONS)
  })

  it('round trips filter and refresh options through storage', () => {
    const storage = memoryStorage()
    const options: ActivityOptions = {
      type: 'CONVERSION',
      side: 'SELL',
      outcome: 'No',
      category: '',
      autoRefreshMs: '30000',
    }

    persistActivityOptions(storage, options)

    expect(readActivityOptions(storage)).toEqual(options)
  })

  it('patches one option without dropping the others', () => {
    const storage = memoryStorage()
    persistActivityOptions(storage, {
      type: 'TRADE',
      side: 'BUY',
      outcome: 'Yes',
      category: 'politics',
      autoRefreshMs: '5000',
    })

    patchActivityOptions(storage, { outcome: 'No' })

    expect(readActivityOptions(storage)).toEqual({
      type: 'TRADE',
      side: 'BUY',
      outcome: 'No',
      category: 'politics',
      autoRefreshMs: '5000',
    })
  })
})
