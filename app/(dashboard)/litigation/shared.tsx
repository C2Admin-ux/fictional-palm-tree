'use client'

// Shared litigation vocabulary + the add/edit modal — used by the list
// page (quick table) and the case detail page so the two can't drift.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsurancePolicy, LitigationCase, Property } from '@/lib/supabase/types'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'

export type CaseWithJoins = LitigationCase & {
  properties?: { name: string } | null
  insurance_policies?: Pick<InsurancePolicy, 'policy_number' | 'policy_type' | 'carrier'> | null
}

export const CASE_TYPES: { value: LitigationCase['case_type']; label: string }[] = [
  { value: 'lawsuit',         label: 'Lawsuit' },
  { value: 'eviction',        label: 'Eviction / FED' },
  { value: 'appeal',          label: 'Appeal' },
  { value: 'fair_housing',    label: 'Fair Housing' },
  { value: 'insurance_claim', label: 'Insurance Claim' },
  { value: 'demand',          label: 'Demand' },
  { value: 'other',           label: 'Other' },
]
export const TYPE_LABEL = Object.fromEntries(CASE_TYPES.map(t => [t.value, t.label]))

export const CASE_STATUSES: { value: LitigationCase['status']; label: string; style: string }[] = [
  { value: 'active',     label: 'Active',           style: 'text-red-700 bg-red-50 border-red-200' },
  { value: 'stayed',     label: 'Stayed',           style: 'text-amber-700 bg-amber-50 border-amber-200' },
  { value: 'settlement', label: 'Settlement talks', style: 'text-violet-700 bg-violet-50 border-violet-200' },
  { value: 'closed',     label: 'Closed',           style: 'text-slate-500 bg-slate-50 border-slate-200' },
]
export const STATUS_META = Object.fromEntries(CASE_STATUSES.map(s => [s.value, s]))
export const STATUS_ORDER: Record<LitigationCase['status'], number> = { active: 0, settlement: 1, stayed: 2, closed: 3 }

export function daysUntilDate(iso: string): number {
  return Math.ceil((new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86400000)
}

// ── Add / edit modal ─────────────────────────────────────────

export function CaseFormModal({ row, properties, policies, onClose, onSaved }: {
  row?: CaseWithJoins
  properties: Property[]
  policies: InsurancePolicy[]
  onClose: () => void
  onSaved: () => void
}) {
  const supabase = createClient()
  const [f, setF] = useState({
    title: row?.title ?? '',
    property_id: row?.property_id ?? '',
    litigant: row?.litigant ?? '',
    case_type: row?.case_type ?? 'lawsuit',
    status: row?.status ?? 'active',
    case_number: row?.case_number ?? '',
    court: row?.court ?? '',
    date_of_notice: row?.date_of_notice ?? '',
    next_deadline: row?.next_deadline ?? '',
    next_deadline_label: row?.next_deadline_label ?? '',
    our_counsel: row?.our_counsel ?? '',
    opposing_counsel: row?.opposing_counsel ?? '',
    insurance_policy_id: row?.insurance_policy_id ?? '',
    claim_number: row?.claim_number ?? '',
    adjuster_name: row?.adjuster_name ?? '',
    adjuster_email: row?.adjuster_email ?? '',
    adjuster_phone: row?.adjuster_phone ?? '',
    demand_amount: row?.demand_amount?.toString() ?? '',
    settlement_amount: row?.settlement_amount?.toString() ?? '',
    resolved_at: row?.resolved_at ?? '',
    notes: row?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(v => ({ ...v, [k]: e.target.value }))

  // Policies for the picked property (portfolio policies have null
  // property_id and are offered everywhere).
  const propertyPolicies = policies.filter(p => !f.property_id || p.property_id === f.property_id || p.property_id == null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) return
    setSaving(true)
    const fields = {
      title: f.title.trim(),
      property_id: f.property_id || null,
      litigant: f.litigant.trim() || null,
      case_type: f.case_type as LitigationCase['case_type'],
      status: f.status as LitigationCase['status'],
      case_number: f.case_number.trim() || null,
      court: f.court.trim() || null,
      date_of_notice: f.date_of_notice || null,
      next_deadline: f.next_deadline || null,
      next_deadline_label: f.next_deadline_label.trim() || null,
      our_counsel: f.our_counsel.trim() || null,
      opposing_counsel: f.opposing_counsel.trim() || null,
      insurance_policy_id: f.insurance_policy_id || null,
      claim_number: f.claim_number.trim() || null,
      adjuster_name: f.adjuster_name.trim() || null,
      adjuster_email: f.adjuster_email.trim() || null,
      adjuster_phone: f.adjuster_phone.trim() || null,
      demand_amount: f.demand_amount !== '' ? parseFloat(f.demand_amount) : null,
      settlement_amount: f.settlement_amount !== '' ? parseFloat(f.settlement_amount) : null,
      resolved_at: f.resolved_at || null,
      notes: f.notes.trim() || null,
    }
    const { error } = row
      ? await supabase.from('litigation_cases')
          .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', row.id)
      : await supabase.from('litigation_cases').insert(fields)
    setSaving(false)
    if (error) { toast(`Couldn't save — ${error.message}`, { tone: 'error' }); return }
    onSaved()
  }

  return (
    <Modal title={row ? 'Edit Case' : 'New Case'} onClose={onClose} maxWidth="xl">
      <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
        <div><label className="label">Title *</label>
          <input required value={f.title} onChange={set('title')} className="input"
            placeholder="e.g. Singleton v. C2 Main Street (habitability)" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Property</label>
            <select value={f.property_id} onChange={set('property_id')} className="input">
              <option value="">None / portfolio</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select></div>
          <div><label className="label">Litigant</label>
            <input value={f.litigant} onChange={set('litigant')} className="input" placeholder="Opposing party" /></div>
          <div><label className="label">Type</label>
            <select value={f.case_type} onChange={set('case_type')} className="input">
              {CASE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select></div>
          <div><label className="label">Status</label>
            <select value={f.status} onChange={set('status')} className="input">
              {CASE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select></div>
          <div><label className="label">Case #</label>
            <input value={f.case_number} onChange={set('case_number')} className="input" /></div>
          <div><label className="label">Court / venue</label>
            <input value={f.court} onChange={set('court')} className="input" /></div>
          <div><label className="label">Date of notice</label>
            <input type="date" value={f.date_of_notice} onChange={set('date_of_notice')} className="input" /></div>
          <div><label className="label">Next deadline</label>
            <input type="date" value={f.next_deadline} onChange={set('next_deadline')} className="input" /></div>
          <div><label className="label">Deadline label</label>
            <input value={f.next_deadline_label} onChange={set('next_deadline_label')} className="input"
              placeholder="e.g. Settlement offer expires" /></div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="label">Our counsel</label>
            <input value={f.our_counsel} onChange={set('our_counsel')} className="input"
              placeholder="Name, firm, phone/email" /></div>
          <div><label className="label">Opposing counsel</label>
            <input value={f.opposing_counsel} onChange={set('opposing_counsel')} className="input"
              placeholder="Or pro se" /></div>
        </div>
        <fieldset className="border border-slate-200 rounded-lg px-3 pb-3 pt-1">
          <legend className="text-xs font-medium text-slate-500 px-1">Insurance</legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label">Policy</label>
              <select value={f.insurance_policy_id} onChange={set('insurance_policy_id')} className="input">
                <option value="">Not tied to a policy</option>
                {propertyPolicies.map(p => (
                  <option key={p.id} value={p.id}>{p.policy_type} — {p.carrier} #{p.policy_number}</option>
                ))}
              </select></div>
            <div><label className="label">Claim #</label>
              <input value={f.claim_number} onChange={set('claim_number')} className="input" /></div>
            <div><label className="label">Adjuster name</label>
              <input value={f.adjuster_name} onChange={set('adjuster_name')} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Adjuster phone</label>
                <input value={f.adjuster_phone} onChange={set('adjuster_phone')} className="input" /></div>
              <div><label className="label">Adjuster email</label>
                <input type="email" value={f.adjuster_email} onChange={set('adjuster_email')} className="input" /></div>
            </div>
          </div>
        </fieldset>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label">Demand ($)</label>
            <input type="number" step="any" value={f.demand_amount} onChange={set('demand_amount')} className="input" /></div>
          <div><label className="label">Settlement ($)</label>
            <input type="number" step="any" value={f.settlement_amount} onChange={set('settlement_amount')} className="input" /></div>
          <div><label className="label">Resolved</label>
            <input type="date" value={f.resolved_at} onChange={set('resolved_at')} className="input" /></div>
        </div>
        <div><label className="label">Background notes</label>
          <textarea value={f.notes} onChange={set('notes')} className="input min-h-[80px] resize-none"
            placeholder="Summary and context — the dated log on the case tracks ongoing developments" /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={saving || !f.title.trim()} className="btn-primary">
            {saving ? 'Saving…' : row ? 'Save' : 'Create case'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
