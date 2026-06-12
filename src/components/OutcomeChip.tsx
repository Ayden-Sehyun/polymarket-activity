import { cn } from '@/lib/utils'
import { formatCents } from '@/format'

/**
 * Maps an outcome string to chip colors per PLAN-styling.md §1:
 *   Yes/Up  → green-600 on green-50
 *   No/Down → red-600 on red-50
 *   other   → gray-700 on gray-100
 */
function outcomeTone(outcome: string): 'yes' | 'no' | 'other' {
  const o = outcome.trim().toLowerCase()
  if (o === 'yes' || o === 'up') return 'yes'
  if (o === 'no' || o === 'down') return 'no'
  return 'other'
}

const TONE_CLASS: Record<'yes' | 'no' | 'other', string> = {
  yes: 'bg-green-50 text-green-600',
  no: 'bg-red-50 text-red-600',
  other: 'bg-[#f4f4f6] text-[#374151]',
}

export function OutcomeChip({
  outcome,
  price,
  showPrice = true,
  className,
}: {
  outcome: string
  price?: number
  showPrice?: boolean
  className?: string
}) {
  if (!outcome) return null
  const tone = outcomeTone(outcome)
  return (
    <span
      data-testid="chip"
      data-outcome={outcome}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-xs font-semibold leading-none',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span>{outcome}</span>
      {showPrice && price !== undefined && Number.isFinite(price) && (
        <span className="font-semibold opacity-80">{formatCents(price)}</span>
      )}
    </span>
  )
}
