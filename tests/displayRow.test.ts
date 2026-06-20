import { describe, expect, it } from 'vitest'
import { toActivityDisplayRow } from '../src/displayRow'
import { activity } from './fixtures'

describe('displayRow', () => {
  it('maps raw activity into stable table display fields', () => {
    const row = activity(1, {
      size: 12.5,
      usdcSize: 6.25,
      price: 0.5,
      title: 'Will the highest temperature in Miami be between 80-81°F on June 20?',
      eventSlug: 'weather-miami-80-81',
    })

    expect(toActivityDisplayRow(row, { [row.eventSlug]: { value: 'weather', label: 'Weather' } })).toMatchObject({
      categoryValue: 'weather',
      city: 'Miami',
      temp: '80-81°F',
      date: 'Jun 20',
      sideLabel: 'Buy',
      typeLabel: 'Trade',
      outcome: 'Yes',
      price: 0.5,
      shares: 12.5,
      amount: 6.25,
      txHref: `https://polygonscan.com/tx/${row.transactionHash}`,
      txHash: row.transactionHash,
    })
  })

  it('keeps raw title fallback and convert label semantics', () => {
    const row = activity(2, {
      type: 'CONVERSION',
      side: '',
      title: 'Highest temperature in Hong Kong on June 11?',
      eventSlug: 'weather-hong-kong',
      price: 0,
    })

    expect(toActivityDisplayRow(row, {})).toMatchObject({
      categoryValue: '',
      city: 'Hong Kong',
      temp: '--',
      date: 'Jun 11',
      sideLabel: '',
      typeLabel: 'Convert',
      price: 0,
    })
  })
})
