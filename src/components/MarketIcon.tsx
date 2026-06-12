import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Market thumbnail: lazy-loaded, rounded; falls back to a flat gray block
 * on empty src or load error (PLAN-styling.md requirement 4).
 */
export function MarketIcon({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const showImg = src && !failed
  if (!showImg) {
    return (
      <div
        data-testid="market-icon-fallback"
        className={cn('shrink-0 rounded-lg bg-[#e7e8eb]', className)}
        aria-hidden
      />
    )
  }
  return (
    <img
      data-testid="market-icon"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-lg bg-[#e7e8eb] object-cover', className)}
    />
  )
}
