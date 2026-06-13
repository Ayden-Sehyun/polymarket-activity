export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

export const formatTimeShort = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Jan 2026" for the profile "Joined …" line. */
export const formatMonthYear = (ts: number) => {
  const d = new Date(ts * 1000)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}
