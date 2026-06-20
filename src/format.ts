import type { Activity, ActivityType, Side } from './api'

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

export const formatTimeShort = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

export const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`

export const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)

export const displayType = (value: ActivityType) => (value === 'CONVERSION' ? 'Convert' : capitalize(value))

export const normalizeDate = (date: string) => date.replace(/\bJune\b/, 'Jun').replace(/\bMay\b/, 'May')

export function compactWeatherTitle(title: string): { city: string; temp: string; date: string; low: boolean } | null {
  const weather = title.match(
    /^Will the (highest|lowest) temperature in (.+?) be (between )?(.+?)(?: or (below|higher))? on (.+?)\?$/,
  )
  if (!weather) {
    const convertWeather = title.match(/^(Highest|Lowest) temperature in (.+?) on (.+?)\?$/)
    if (!convertWeather) return null
    const [, highLow, city, rawDate] = convertWeather
    return { city: city.trim(), temp: '--', date: normalizeDate(rawDate.trim()), low: highLow === 'Lowest' }
  }

  const [, highLow, city, between, rawTemp, direction, rawDate] = weather
  const temp = rawTemp
    .replace(/\s+/g, ' ')
    .replace(/(\d+)\s*-\s*(\d+)/, '$1-$2')
    .trim()
  const qualifier = between ? temp : direction === 'below' ? `<=${temp}` : direction === 'higher' ? `>=${temp}` : temp
  const date = normalizeDate(rawDate.trim())
  return { city: city.trim(), temp: qualifier, date, low: highLow === 'lowest' }
}

export const cityLabel = (row: Activity) => compactWeatherTitle(row.title)?.city ?? row.title

export const rawEventAccent = (eventSlug: string) => {
  let hash = 0
  for (let i = 0; i < eventSlug.length; i += 1) {
    hash = (hash * 31 + eventSlug.charCodeAt(i)) >>> 0
  }
  return `hsl(${hash % 360} 62% 42% / 0.9)`
}

export const sideClass = (value: Side | '') =>
  value === 'BUY'
    ? 'text-green-600'
    : value === 'SELL'
      ? 'text-red-600'
      : 'text-foreground'

export const outcomeClass = (value: string) =>
  value.toLowerCase() === 'yes'
    ? 'text-green-600'
    : value.toLowerCase() === 'no'
      ? 'text-red-600'
      : 'text-foreground'

export function formatDecimal(value: number, decimals: number) {
  if (!Number.isFinite(value)) return null
  const fixed = value.toFixed(decimals)
  const [whole, fraction = ''] = fixed.split('.')
  const meaningfulLength = fraction.replace(/0+$/, '').length
  return {
    whole,
    meaningful: fraction.slice(0, meaningfulLength),
    padding: fraction.slice(meaningfulLength),
  }
}

export function formatPusdBalance(value: number) {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}
