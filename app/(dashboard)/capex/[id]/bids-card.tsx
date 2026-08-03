'use client'

// Vendor bids card on the capex detail page — a sibling of the Budget
// Overview and Line Items cards. Tracks competing quotes from request
// through decision: add/edit bids, mark received (amount + PDF),
// decline, compare received bids against the low bid and the project
// budget, and select a winner (auto-rejecting the rest).

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { CapexBid, CapexProject } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, todayISO } from '@/lib/utils'
import { bidGlance } from '@/lib/capex/bids'
import { BidChip } from '@/components/capex/bid-chip'
import { BUCKET, signedFileUrl, removeFiles } from '@/lib/storage'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Plus, FileText, Trash2, Pencil } from 'lucide-react'

const BID_STATUS_STYLES: Record<CapexBid['status'], string> = {
  requested: 'text-slate-600 bg-slate-50 border-slate-200',
  received:  'text-blue-700 bg-blue-50 border-blue-200',
  declined:  'text-slate-400 bg-slate-50 border-slate-200 line-through',
  selected:  'text-emerald-700 bg-emerald-50 border-emerald-200',
  rejected:  'text-slate-400 bg-slate-50 border-slate-200',
}

// Display order: winner first, quotes in hand (cheapest first), still
// outstanding, then the post-decision/withdrawn tail.
const STATUS_ORDER: Record<CapexBid['status'], number> = {
  selected: 0, received: 1, requested: 2, rejected: 3, declined: 4,
}

type ProjectLite = Pick<CapexProject, 'id' | 'property_id' | 'budget' | 'bids_target'>

export function BidsCard({ project, bids, onChanged }: {
  project: ProjectLite
  bids: CapexBid[]
  onChanged: () => void
}) {
  const supabase = createClient()
  // form: null = closed; { bid } = edit; { bid, markReceived } = the
  // "Mark received" prompt (same modal, status pinned to received).
  const [form, setForm] = useState<{ bid?: CapexBid; markReceived?: boolean } | null>(null)
  const [selecting, setSelecting] = useState<CapexBid | null>(null)
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({})
  // Bid-target inline edit (null = not editing)
  const [targetDraft, setTargetDraft] = useState<string | null>(null)
  const cancelTarget = useRef(false)

  const glance = bidGlance(bids, project.bids_target)
  const sorted = [...bids].sort((a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    (a.amount ?? Infinity) - (b.amount ?? Infinity))

  // Comparison pool: every quote actually in hand (received, plus the
  // post-decision selected/rejected so the deltas survive a decision).
  const comparable = bids.filter(b =>
    b.amount != null && (b.status === 'received' || b.status === 'selected' || b.status === 'rejected'))
  const lowAmount = comparable.length ? Math.min(...comparable.map(b => b.amount as number)) : null
  const lowId = lowAmount != null ? comparable.find(b => b.amount === lowAmount)?.id : undefined

  async function saveTarget() {
    const v = targetDraft?.trim() ?? ''
    setTargetDraft(null)
    const parsed = v === '' ? null : parseInt(v, 10)
    const next = parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : null
    if (next === (project.bids_target ?? null)) return
    const { error } = await supabase.from('capex_projects')
      .update({ bids_target: next }).eq('id', project.id)
    if (error) toast(`Couldn't save bid target — ${error.message}`, { tone: 'error' })
    onChanged()
  }

  async function declineBid(bid: CapexBid) {
    const { error } = await supabase.from('capex_bids')
      .update({ status: 'declined' }).eq('id', bid.id)
    if (error) toast(`Couldn't update bid — ${error.message}`, { tone: 'error' })
    onChanged()
  }

  // House delete pattern: delete immediately, offer Undo via toast. The
  // PDF (if any) stays in storage either way, so undo restores the full
  // row — including file_path — intact.
  async function deleteBid(bid: CapexBid) {
    const { error } = await supabase.from('capex_bids').delete().eq('id', bid.id)
    if (error) { toast(`Couldn't delete bid — ${error.message}`, { tone: 'error' }); return }
    onChanged()
    toast(`Bid from ${bid.vendor_name} deleted`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const { error: e } = await supabase.from('capex_bids').insert(bid)
          if (e) toast(`Couldn't restore bid — ${e.message}`, { tone: 'error' })
          onChanged()
        },
      },
    })
  }

  // Reverse a decision: selected AND rejected both go back to received.
  // NOTE: this loses requested-vs-received granularity for bids that
  // were auto-rejected while still outstanding — they come back as
  // received even though no quote was ever in hand. Acceptable v1;
  // the owner can edit any bid back to requested.
  async function reopenDecision() {
    const { error } = await supabase.from('capex_bids')
      .update({ status: 'received' })
      .eq('project_id', project.id)
      .in('status', ['selected', 'rejected'])
    if (error) toast(`Couldn't reopen decision — ${error.message}`, { tone: 'error' })
    onChanged()
  }

  async function openPdf(bid: CapexBid) {
    if (!bid.file_path) return
    const { url, error } = await signedFileUrl(supabase, bid.file_path)
    if (url) window.open(url, '_blank', 'noopener')
    else toast(`Couldn't open PDF — ${error}`, { tone: 'error' })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          Bids
          <BidChip bids={bids} target={project.bids_target} />
        </h2>
        <div className="flex items-center gap-2">
          {targetDraft == null ? (
            <button onClick={() => setTargetDraft(project.bids_target?.toString() ?? '')}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
              title="How many bids to gather before deciding (blank = no target)">
              Target: {project.bids_target != null ? `${project.bids_target} bids` : '—'}
            </button>
          ) : (
            <input autoFocus type="number" min={1} value={targetDraft}
              onChange={e => setTargetDraft(e.target.value)}
              onBlur={() => {
                if (cancelTarget.current) { cancelTarget.current = false; setTargetDraft(null); return }
                saveTarget()
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { cancelTarget.current = true; (e.target as HTMLInputElement).blur() }
              }}
              className="input-sm w-16" aria-label="Bid target" placeholder="none" />
          )}
          {glance.state === 'decided' && (
            <button onClick={reopenDecision} className="btn-ghost text-xs py-1">Reopen decision</button>
          )}
          <button onClick={() => setForm({})} className="btn-secondary text-xs py-1">
            <Plus size={12} />Add bid
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No bids yet — add vendors as you request quotes
          {project.bids_target != null && ` (target: ${project.bids_target})`}
        </p>
      ) : (
        <div className="divide-y divide-slate-200/70">
          {sorted.map(b => {
            const inactive = b.status === 'declined' || b.status === 'rejected'
            const overBudget = b.amount != null && project.budget != null && project.budget > 0 && b.amount > project.budget
            const expanded = !!expandedNotes[b.id]
            return (
              <div key={b.id} className={cn('py-3 space-y-1.5 group', inactive && 'opacity-60')}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-800">{b.vendor_name}</span>
                  <span className={cn('badge capitalize', BID_STATUS_STYLES[b.status])}>{b.status}</span>
                  {b.id === lowId && b.status !== 'rejected' && (
                    <span className="badge text-emerald-700 bg-emerald-50 border-emerald-200">low bid</span>
                  )}
                  {b.file_path && (
                    <button onClick={() => openPdf(b)}
                      className="badge text-slate-600 bg-slate-50 border-slate-200 hover:bg-slate-100 gap-1 cursor-pointer transition-colors"
                      title={b.file_name ?? 'Bid PDF'}>
                      <FileText size={10} />PDF
                    </button>
                  )}
                  <span className="ml-auto text-sm font-semibold text-slate-900">
                    {formatCurrency(b.amount)}
                  </span>
                </div>

                {/* Deltas vs low bid + budget — only for quotes in hand */}
                {b.amount != null && !inactive && b.status !== 'requested' && (lowAmount != null || overBudget) && (
                  <div className="flex items-center gap-2 justify-end text-xs">
                    {lowAmount != null && b.id !== lowId && (
                      <span className="text-slate-500">+{formatCurrency(b.amount - lowAmount)} vs low</span>
                    )}
                    {overBudget && (
                      <span className="text-red-600 font-medium">
                        +{formatCurrency((b.amount as number) - (project.budget as number))} over budget
                      </span>
                    )}
                  </div>
                )}

                <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-slate-400">
                  {b.vendor_email && <span>{b.vendor_email}</span>}
                  {b.vendor_phone && <span>{b.vendor_phone}</span>}
                  {b.requested_at && <span>requested {formatDate(b.requested_at)}</span>}
                  {b.received_at && <span>received {formatDate(b.received_at)}</span>}
                  {b.valid_until && <span>valid until {formatDate(b.valid_until)}</span>}
                </div>

                {b.scope_notes && (
                  <p onClick={() => setExpandedNotes(n => ({ ...n, [b.id]: !n[b.id] }))}
                    title={expanded ? 'Collapse' : 'Expand'}
                    className={cn('text-xs text-slate-500 cursor-pointer', expanded ? 'whitespace-pre-line' : 'truncate')}>
                    {b.scope_notes}
                  </p>
                )}

                <div className="flex items-center gap-1.5 flex-wrap">
                  {b.status === 'requested' && (
                    <>
                      <button onClick={() => setForm({ bid: b, markReceived: true })}
                        className="btn-secondary text-xs py-1 px-2">Mark received</button>
                      <button onClick={() => declineBid(b)}
                        className="btn-ghost text-xs py-1 px-2">Declined</button>
                    </>
                  )}
                  {b.status === 'received' && (
                    <button onClick={() => setSelecting(b)}
                      className="btn-primary text-xs py-1 px-2.5">Select</button>
                  )}
                  <span className="ml-auto flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setForm({ bid: b })} aria-label="Edit bid"
                      className="p-1.5 text-slate-300 hover:text-slate-600 transition-colors">
                      <Pencil size={12} />
                    </button>
                    <button onClick={() => deleteBid(b)} aria-label="Delete bid"
                      className="p-1.5 text-slate-300 hover:text-red-400 transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {form && (
        <BidFormModal project={project} bid={form.bid} markReceived={form.markReceived}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); onChanged() }} />
      )}
      {selecting && (
        <SelectBidModal project={project} bid={selecting}
          others={bids.filter(b => b.id !== selecting.id && b.status !== 'declined')}
          onClose={() => setSelecting(null)}
          onDone={() => { setSelecting(null); onChanged() }} />
      )}
    </div>
  )
}

// ── Add / edit / mark-received modal ─────────────────────────

function BidFormModal({ project, bid, markReceived, onClose, onSaved }: {
  project: ProjectLite
  bid?: CapexBid
  markReceived?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  // Status is user-editable only pre-decision; a selected/rejected/
  // declined bid keeps its status through an edit.
  const statusEditable = !markReceived && (bid == null || bid.status === 'requested' || bid.status === 'received')
  const [form, setFormState] = useState({
    vendor_name: bid?.vendor_name ?? '',
    vendor_email: bid?.vendor_email ?? '',
    vendor_phone: bid?.vendor_phone ?? '',
    status: (markReceived ? 'received' : bid?.status ?? 'requested') as CapexBid['status'],
    amount: bid?.amount?.toString() ?? '',
    received_at: bid?.received_at ?? todayISO(),
    valid_until: bid?.valid_until ?? '',
    scope_notes: bid?.scope_notes ?? '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setFormState(f => ({ ...f, [k]: e.target.value }))

  // The status this save will write: the select's value when editable
  // (or the pinned 'received' for mark-received), else unchanged.
  const effectiveStatus: CapexBid['status'] =
    statusEditable || markReceived ? form.status : (bid as CapexBid).status
  const received = effectiveStatus === 'received' || effectiveStatus === 'selected' || effectiveStatus === 'rejected'

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.vendor_name.trim()) return
    setSaving(true)

    let file_path = bid?.file_path ?? null
    let file_name = bid?.file_name ?? null
    if (file) {
      const path = `${project.property_id}/capex/${project.id}/bids/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream' })
      if (error) {
        toast(`Couldn't upload file — ${error.message}`, { tone: 'error' })
        setSaving(false)
        return
      }
      file_path = path
      file_name = file.name
    }

    const fields = {
      vendor_name: form.vendor_name.trim(),
      vendor_email: form.vendor_email.trim() || null,
      vendor_phone: form.vendor_phone.trim() || null,
      status: effectiveStatus,
      amount: form.amount !== '' ? parseFloat(form.amount) : null,
      received_at: received ? (form.received_at || todayISO()) : null,
      valid_until: received && form.valid_until ? form.valid_until : null,
      scope_notes: form.scope_notes.trim() || null,
      file_path, file_name,
    }
    const { error } = bid
      ? await supabase.from('capex_bids')
          .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', bid.id)
      : await supabase.from('capex_bids').insert({ ...fields, project_id: project.id })
    setSaving(false)
    if (error) { toast(`Couldn't save bid — ${error.message}`, { tone: 'error' }); return }
    onSaved()
  }

  return (
    <Modal
      title={markReceived ? `Mark bid received — ${bid?.vendor_name}` : bid ? 'Edit Bid' : 'Add Bid'}
      onClose={onClose} maxWidth="lg">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        {!markReceived && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2"><label className="label">Vendor *</label>
              <input required value={form.vendor_name} onChange={set('vendor_name')} className="input" placeholder="e.g. Summit Roofing" /></div>
            <div><label className="label">Email</label>
              <input type="email" value={form.vendor_email} onChange={set('vendor_email')} className="input" /></div>
            <div><label className="label">Phone</label>
              <input value={form.vendor_phone} onChange={set('vendor_phone')} className="input" /></div>
            {statusEditable && (
              <div><label className="label">Status</label>
                <select value={form.status} onChange={set('status')} className="input">
                  <option value="requested">Requested</option>
                  <option value="received">Received</option>
                </select></div>
            )}
          </div>
        )}
        {received && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Amount ($)</label>
              <input type="number" step="any" value={form.amount} onChange={set('amount')} className="input" placeholder="0" autoFocus={!!markReceived} /></div>
            <div><label className="label">Received</label>
              <input type="date" value={form.received_at} onChange={set('received_at')} className="input" /></div>
            <div><label className="label">Valid Until</label>
              <input type="date" value={form.valid_until} onChange={set('valid_until')} className="input" /></div>
            <div><label className="label">Bid PDF</label>
              <input type="file" accept="application/pdf"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:bg-white file:text-xs file:text-slate-600 hover:file:bg-slate-50" />
              {bid?.file_name && !file && <p className="text-xs text-slate-400 mt-1 truncate">current: {bid.file_name}</p>}
            </div>
          </div>
        )}
        <div><label className="label">Scope Notes</label>
          <textarea value={form.scope_notes} onChange={set('scope_notes')} className="input min-h-[60px] resize-none" placeholder="What's included / excluded, warranty, timeline…" /></div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || !form.vendor_name.trim()} className="btn-primary">
            {saving ? 'Saving…' : markReceived ? 'Mark received' : bid ? 'Save' : 'Add bid'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Select-winner confirm dialog ─────────────────────────────

function SelectBidModal({ project, bid, others, onClose, onDone }: {
  project: ProjectLite
  bid: CapexBid
  others: CapexBid[]   // display only — confirm() re-derives the reject set from server truth
  onClose: () => void
  onDone: () => void
}) {
  const supabase = createClient()
  const [applyToProject, setApplyToProject] = useState(true)
  const [saving, setSaving] = useState(false)

  // Ordered for crash-safety around the partial unique index (0009):
  // re-check server truth, write the WINNER first (a unique violation
  // means a concurrent/duplicate select won), then reject the rest,
  // then the optional project write. Each later step failing leaves an
  // earlier, more important step intact.
  async function confirm() {
    if (saving) return // double-click guard
    setSaving(true)

    // 1. Server truth — the card's props may be stale (another tab/user).
    const { data: current, error: fetchError } = await supabase.from('capex_bids')
      .select('id, vendor_name, status').eq('project_id', project.id)
    if (fetchError || !current) {
      toast(`Couldn't check current bids — ${fetchError?.message ?? 'no data'}`, { tone: 'error' })
      setSaving(false)
      return
    }
    const alreadySelected = current.find(b => b.status === 'selected')
    if (alreadySelected) {
      toast(`A bid is already selected (${alreadySelected.vendor_name}) — reopen the decision first`, { tone: 'error' })
      onDone()
      return
    }
    if (!current.some(b => b.id === bid.id)) {
      toast(`This bid no longer exists — it may have been deleted`, { tone: 'error' })
      onDone()
      return
    }

    // 2. Winner first — the unique index makes this the atomic "decision".
    const { error } = await supabase.from('capex_bids')
      .update({ status: 'selected' }).eq('id', bid.id)
    if (error) {
      // 23505 = unique violation: someone selected between our check and now.
      if (error.code === '23505') {
        toast(`A bid is already selected — reopen the decision first`, { tone: 'error' })
        onDone()
      } else {
        toast(`Couldn't select bid — ${error.message}`, { tone: 'error' })
        setSaving(false)
      }
      return
    }

    // 3. Reject the rest (from server truth, not props). A failure here is
    // recoverable: reopen the decision and select again.
    const toReject = current.filter(b =>
      b.id !== bid.id && b.status !== 'declined' && b.status !== 'rejected')
    if (toReject.length > 0) {
      const { error: e } = await supabase.from('capex_bids')
        .update({ status: 'rejected' }).in('id', toReject.map(o => o.id))
      if (e) toast(
        `Winner selected, but couldn't reject ${toReject.map(o => o.vendor_name).join(', ')} — ${e.message}. Reopen the decision and select again to retry.`,
        { tone: 'error' })
    }

    // 4. Optional project write — its own error; the selection stands.
    if (applyToProject) {
      const { error: e } = await supabase.from('capex_projects')
        .update({
          vendor_name: bid.vendor_name,
          ...(bid.amount != null ? { committed: bid.amount } : {}),
        })
        .eq('id', project.id)
      if (e) toast(`Winner selected, but couldn't update project — ${e.message}`, { tone: 'error' })
    }
    onDone()
  }

  return (
    <Modal title="Select winning bid" onClose={onClose} maxWidth="md">
      <div className="px-6 py-5 space-y-4">
        <p className="text-sm text-slate-700">
          Select <span className="font-semibold">{bid.vendor_name}</span>
          {bid.amount != null && <> at <span className="font-semibold">{formatCurrency(bid.amount)}</span></>}?
        </p>
        <ul className="text-sm text-slate-500 list-disc pl-5 space-y-1">
          <li>This bid becomes <span className="text-emerald-700 font-medium">selected</span>.</li>
          <li>
            {others.length === 0
              ? 'No other bids to reject.'
              : <>{others.length} other bid{others.length === 1 ? '' : 's'} ({others.map(o => o.vendor_name).join(', ')}) will be marked <span className="font-medium">rejected</span>.</>}
          </li>
        </ul>
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={applyToProject}
            onChange={e => setApplyToProject(e.target.checked)} className="mt-0.5" />
          <span>
            Set the project&apos;s vendor to {bid.vendor_name}
            {bid.amount != null && <> and committed to {formatCurrency(bid.amount)}</>}
          </span>
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={confirm} disabled={saving} className="btn-primary">
            {saving ? 'Selecting…' : 'Select bid'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
