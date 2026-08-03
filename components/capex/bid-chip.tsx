'use client'

import { cn } from '@/lib/utils'
import { bidGlance, bidChipLabel, BID_CHIP_TONES, type BidLike } from '@/lib/capex/bids'

// One compact bid-status chip, shared by the board cards, the list's
// desktop rows/mobile cards, and the detail page's Bids card header.
// Renders nothing unless the project has bids or a bid target; tooltip
// lists who we're still waiting on.
export function BidChip({ bids, target, className }: {
  bids: BidLike[] | null | undefined
  target: number | null
  className?: string
}) {
  const list = bids ?? []
  if (list.length === 0 && target == null) return null
  const g = bidGlance(list, target)
  return (
    <span
      title={g.outstandingVendors.length ? `Waiting on: ${g.outstandingVendors.join(', ')}` : undefined}
      className={cn('badge whitespace-nowrap font-medium', BID_CHIP_TONES[g.state], className)}>
      {bidChipLabel(g)}
    </span>
  )
}
