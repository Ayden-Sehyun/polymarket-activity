export const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`

export const formatTimeShort = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
