const sig6 = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 })
const usdSig6 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 6,
})
// Full double precision (15 sig digits) for the chip price: most fills sit on
// the 0.1¢ tick, but average fills carry long fractions worth showing in full.
// 15 (not 17) also hides the float dust that the ×100 in formatCents introduces.
const centsFull = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 15 })

export const formatNumber = (n: number) => sig6.format(n)
export const formatUsd = (n: number) => usdSig6.format(n)
export const formatTime = (ts: number) => new Date(ts * 1000).toLocaleString()
export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

export const formatTimeShort = (ts: number) =>
  new Date(ts * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })

/** A 0–1 probability shown in cents inside the outcome chip, e.g. 0.999 → "99.90¢" (min 2 decimals). */
export const formatCents = (price: number) => {
  const s = centsFull.format(price * 100)
  const [int, frac = ''] = s.split('.')
  return frac.length >= 2 ? `${s}¢` : `${int}.${frac.padEnd(2, '0')}¢`
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
]

/** "2h ago" style relative time from a unix-seconds timestamp. */
export const relativeTime = (ts: number, now: number = Date.now()) => {
  const diffSec = Math.round((ts * 1000 - now) / 1000)
  const abs = Math.abs(diffSec)
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit)
    }
  }
  return rtf.format(0, 'second')
}

/** Exact local timestamp for the relative-time tooltip. */
export const formatTimeExact = (ts: number) => new Date(ts * 1000).toLocaleString()

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jan 2026" for the profile "Joined …" line. */
export const formatMonthYear = (ts: number) => {
  const d = new Date(ts * 1000)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
