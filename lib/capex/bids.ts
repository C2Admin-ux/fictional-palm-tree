import type { CapexBid } from '@/lib/supabase/types'
import { formatCurrency } from '@/lib/utils'

// ── Bid glance derivation ────────────────────────────────────
// Single source of truth for "where does bidding stand?" on a capex
// project — the detail card header, the list rows, and the board cards
// all derive their chip from here. Pure: no fetching, no React.
//
// Status semantics (see 0009_capex_bids.sql):
//   requested  — bid asked for, nothing in hand yet ("outstanding")
//   received   — quote in hand
//   declined   — vendor bowed out: counts toward NEITHER outstanding
//                nor received
//   selected / rejected — post-decision statuses (a decision implies the
//                bid was in hand, so both still count as received)

// Lean shape the list/board fetch embeds (`capex_bids(vendor_name,
// status, amount)`); the detail page passes full rows.
export type BidLike = Pick<CapexBid, 'vendor_name' | 'status' | 'amount'>

export type BidGlanceState = 'none' | 'gathering' | 'ready' | 'decided'

export type BidGlance = {
  state: BidGlanceState
  received: number
  requested: number            // outstanding count
  target: number | null
  outstandingVendors: string[]
  selected?: { vendor_name: string; amount: number | null }
}

export function bidGlance(bids: BidLike[], target: number | null | undefined): BidGlance {
  const t = target ?? null
  const selectedBid = bids.find(b => b.status === 'selected')
  const outstanding = bids.filter(b => b.status === 'requested')
  const received = bids.filter(b =>
    b.status === 'received' || b.status === 'selected' || b.status === 'rejected').length

  const state: BidGlanceState =
    selectedBid ? 'decided'
    : received >= 1 && outstanding.length === 0 && (t == null || received >= t) ? 'ready'
    : bids.length > 0 ? 'gathering'
    : 'none'

  return {
    state,
    received,
    requested: outstanding.length,
    target: t,
    outstandingVendors: outstanding.map(b => b.vendor_name),
    ...(selectedBid ? { selected: { vendor_name: selectedBid.vendor_name, amount: selectedBid.amount } } : {}),
  }
}

// Compact one-chip label:
//   "0/3 bids"                        target set, nothing outstanding/in
//   "2/3 — waiting on Acme"           outstanding bids (name when just one)
//   "2/4 — waiting on 2 vendors"
//   "3 bids in — ready to decide"
//   "✓ Acme · $12K"                   decided
// The denominator is the target when set, else received + outstanding.
export function bidChipLabel(g: BidGlance): string {
  if (g.state === 'decided' && g.selected) {
    const amt = g.selected.amount != null ? ` · ${formatCurrency(g.selected.amount, true)}` : ''
    return `✓ ${g.selected.vendor_name}${amt}`
  }
  if (g.state === 'ready')
    return `${g.received} bid${g.received === 1 ? '' : 's'} in — ready to decide`
  const total = g.target ?? g.received + g.requested
  if (g.requested > 0) {
    const waiting = g.requested === 1 ? g.outstandingVendors[0] : `${g.requested} vendors`
    return `${g.received}/${total} — waiting on ${waiting}`
  }
  // No outstanding but not ready: target unmet ("1/3 bids") — or every
  // bid was declined (total 0), where the count reads better bare.
  return total > 0 ? `${g.received}/${total} bids` : `${g.received} bids`
}

// Chip tones per state — kept beside the derivation so every chip
// surface (board card, list row, detail header) matches. decided is a
// deliberately quiet emerald: the loud states are the actionable ones.
export const BID_CHIP_TONES: Record<BidGlanceState, string> = {
  none:      'text-slate-500 bg-slate-50 border-slate-200',
  gathering: 'text-amber-700 bg-amber-50 border-amber-200',
  ready:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  decided:   'text-emerald-600 bg-white border-slate-200',
}
