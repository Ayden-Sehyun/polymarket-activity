import { useState } from 'react'
import { cn } from '@/lib/utils'

/** Cheap stable string hash → 32-bit unsigned. */
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Deterministic two-stop gradient derived from an address (when no profileImage). */
export function gradientFromAddress(address: string): string {
  const h = hashString(address.toLowerCase())
  const a = h % 360
  const b = (a + 40 + ((h >> 9) % 120)) % 360
  return `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 45%))`
}

export function ProfileAvatar({
  address,
  src,
  className,
}: {
  address: string
  src?: string
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed
  return (
    <div
      data-testid="avatar"
      className={cn('shrink-0 overflow-hidden rounded-full bg-muted', className)}
      style={showImg ? undefined : { backgroundImage: gradientFromAddress(address) }}
    >
      {showImg && (
        <img
          src={src}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
