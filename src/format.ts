import type { Activity, ActivityType, Side } from './api'

export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

export const formatTimeShort = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

export const txHref = (hash: string) => `https://polygonscan.com/tx/${hash}`

const capitalize = (s: string) => (s ? s[0] + s.slice(1).toLowerCase() : s)

export const displayType = (value: ActivityType) => (value === 'CONVERSION' ? 'Convert' : capitalize(value))

const normalizeDate = (date: string) => date.replace(/\bJune\b/, 'Jun').replace(/\bMay\b/, 'May')

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

const TAILWIND_DISTINCT_ACCENTS = [
  'oklch(63.7% 0.237 25.331 / 0.45)', // red-500
  'oklch(71.5% 0.143 215.221 / 0.45)', // cyan-500
  'oklch(64.5% 0.246 16.439 / 0.45)', // rose-500
  'oklch(70.4% 0.14 182.503 / 0.45)', // teal-500
  'oklch(65.6% 0.241 354.308 / 0.45)', // pink-500
  'oklch(69.6% 0.17 162.48 / 0.45)', // emerald-500
  'oklch(66.7% 0.295 322.15 / 0.45)', // fuchsia-500
  'oklch(72.3% 0.219 149.579 / 0.45)', // green-500
  'oklch(62.7% 0.265 303.9 / 0.45)', // purple-500
  'oklch(76.8% 0.233 130.85 / 0.45)', // lime-500
  'oklch(60.6% 0.25 292.717 / 0.45)', // violet-500
  'oklch(79.5% 0.184 86.047 / 0.45)', // yellow-500
  'oklch(58.5% 0.233 277.117 / 0.45)', // indigo-500
  'oklch(76.9% 0.188 70.08 / 0.45)', // amber-500
  'oklch(62.3% 0.214 259.815 / 0.45)', // blue-500
  'oklch(70.5% 0.213 47.604 / 0.45)', // orange-500
  'oklch(68.5% 0.169 237.323 / 0.45)', // sky-500
] as const

export const eventAccentForIndex = (index: number) =>
  TAILWIND_DISTINCT_ACCENTS[index % TAILWIND_DISTINCT_ACCENTS.length]

export const sequentialEventGroupAccents = (rows: Pick<Activity, 'eventSlug'>[]) => {
  const accents: string[] = []
  let currentGroupIndex = -1
  let previousSlug = ''
  for (const row of rows) {
    if (!row.eventSlug) {
      previousSlug = ''
      accents.push('transparent')
      continue
    }
    if (row.eventSlug !== previousSlug) {
      currentGroupIndex += 1
      previousSlug = row.eventSlug
    }
    accents.push(eventAccentForIndex(currentGroupIndex))
  }
  return accents
}

export const sideClass = (value: Side | '') =>
  value === 'BUY' ? 'text-green-600' : value === 'SELL' ? 'text-red-600' : 'text-foreground'

export const outcomeClass = (value: string) =>
  value.toLowerCase() === 'yes' ? 'text-green-600' : value.toLowerCase() === 'no' ? 'text-red-600' : 'text-foreground'

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
