import { describe, expect, it } from 'vitest'
import {
  categoryForRow,
  categoryFromActivity,
  categoryFromMetadata,
  filterRows,
  getCategoryOptions,
} from '../src/category'
import { activity } from './fixtures'

describe('category helpers', () => {
  it('infers common market categories from activity text', () => {
    expect(
      categoryFromActivity(
        activity(1, {
          title: 'Will the highest temperature in Miami be 90°F on June 20?',
          eventSlug: 'weather-miami-90',
        }),
      ),
    ).toEqual({ value: 'weather', label: 'Weather' })
    expect(categoryFromActivity(activity(2, { title: 'Will Trump win?', eventSlug: 'us-election' }))).toEqual({
      value: 'politics',
      label: 'Politics',
    })
    expect(
      categoryFromActivity(
        activity(3, {
          title: 'Will Bitcoin hit 100k?',
          slug: 'bitcoin-100k',
          eventSlug: 'bitcoin-100k',
        }),
      ),
    ).toEqual({ value: 'crypto', label: 'Crypto' })
  })

  it('prioritizes metadata tags and aliases before raw category fallback', () => {
    expect(
      categoryFromMetadata({
        slug: 'nba-finals',
        category: 'news',
        tags: [
          { label: 'All', slug: 'all' },
          { label: 'NBA', slug: 'nba' },
        ],
      }),
    ).toEqual({ value: 'sports', label: 'Sports' })
  })

  it('filters rows by selected outcome and category', () => {
    const weatherYes = activity(1, {
      outcome: 'Yes',
      title: 'Will the highest temperature in Miami be 90°F on June 20?',
      eventSlug: 'weather-miami-90',
    })
    const weatherNo = activity(2, {
      outcome: 'No',
      title: 'Will the lowest temperature in Miami be 70°F on June 20?',
      eventSlug: 'weather-miami-70',
    })
    const politicsNo = activity(3, { outcome: 'No', title: 'Will Alice win the election?', eventSlug: 'election-2028' })

    expect(filterRows([weatherYes, weatherNo, politicsNo], 'No', 'weather', {})).toEqual([weatherNo])
    expect(categoryForRow(weatherYes, {})).toEqual({ value: 'weather', label: 'Weather' })
    expect(getCategoryOptions([weatherYes, politicsNo], {}).map((option) => option.value)).toEqual(['politics', 'weather'])
  })
})
