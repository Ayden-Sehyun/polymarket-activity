import { describe, expect, it } from 'vitest'
import {
  cityLabel,
  compactWeatherTitle,
  displayType,
  eventAccentForIndex,
  formatDecimal,
  formatPusdBalance,
  formatTimeShort,
  outcomeClass,
  sequentialEventGroupAccents,
  shortHash,
  sideClass,
  txHref,
} from '../src/format'
import { activity } from './fixtures'

describe('format helpers', () => {
  it('formats wallet, tx, type, side, and outcome labels', () => {
    expect(shortHash('0x774728ed9264a5ca242e8bd7952a869df318fe40')).toBe('0x7747…fe40')
    expect(txHref('0xabc')).toBe('https://polygonscan.com/tx/0xabc')
    expect(displayType('CONVERSION')).toBe('Convert')
    expect(displayType('REDEEM')).toBe('Redeem')
    expect(sideClass('BUY')).toBe('text-green-600')
    expect(sideClass('SELL')).toBe('text-red-600')
    expect(outcomeClass('Yes')).toBe('text-green-600')
    expect(outcomeClass('No')).toBe('text-red-600')
  })

  it('parses weather titles into compact city/temp/date fields', () => {
    expect(compactWeatherTitle('Will the highest temperature in Miami be between 80-81°F on June 11?')).toEqual({
      city: 'Miami',
      temp: '80-81°F',
      date: 'Jun 11',
      low: false,
    })
    expect(compactWeatherTitle('Will the lowest temperature in Shanghai be 14°C or below on June 11?')).toEqual({
      city: 'Shanghai',
      temp: '<=14°C',
      date: 'Jun 11',
      low: true,
    })
    expect(compactWeatherTitle('Will the highest temperature in Warsaw be 22°C or higher on June 11?')).toMatchObject({
      city: 'Warsaw',
      temp: '>=22°C',
    })
    expect(compactWeatherTitle('Highest temperature in Hong Kong on June 11?')).toEqual({
      city: 'Hong Kong',
      temp: '--',
      date: 'Jun 11',
      low: false,
    })
  })

  it('falls back to raw title when a row is not compact weather', () => {
    const row = activity(1, { title: 'Will Alice win the 2028 presidential election?' })

    expect(cityLabel(row)).toBe(row.title)
  })

  it('keeps decimal padding separate so faint trailing zeroes can align numbers', () => {
    expect(formatDecimal(0.005, 5)).toEqual({ whole: '0', meaningful: '005', padding: '00' })
    expect(formatDecimal(7.48214, 5)).toEqual({ whole: '7', meaningful: '48214', padding: '' })
    expect(formatDecimal(Number.NaN, 5)).toBeNull()
    expect(formatPusdBalance(61.789)).toBe('61.79')
  })

  it('renders short local time without date text', () => {
    expect(formatTimeShort(1_781_900_000)).toMatch(/^\d{1,2}:\d{2}\s?[AP]M$/i)
  })

  it('maps contiguous event groups to neighbor-distinct Tailwind default colors', () => {
    const accents = sequentialEventGroupAccents([
      activity(1, { eventSlug: 'miami' }),
      activity(2, { eventSlug: 'miami' }),
      activity(3, { eventSlug: 'karachi' }),
      activity(4, { eventSlug: 'miami' }),
      activity(5, { eventSlug: 'wuhan' }),
    ])

    expect(accents).toEqual([
      eventAccentForIndex(0),
      eventAccentForIndex(0),
      eventAccentForIndex(1),
      eventAccentForIndex(2),
      eventAccentForIndex(3),
    ])
    expect(accents[0]).toContain('25.331')
    expect(accents[2]).toContain('215.221')
    expect(accents[3]).toContain('16.439')
    expect(accents[0]).toMatch(/^oklch\(.+ \/ 0\.9\)$/)
  })
})
