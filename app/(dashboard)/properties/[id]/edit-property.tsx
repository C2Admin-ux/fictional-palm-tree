'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { Pmc, Property } from '@/lib/supabase/types'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/components/ui/toast'
import { Pencil, Check } from 'lucide-react'

// ── Edit property (identity fields) ──────────────────────────
// Header pencil → modal for the PROPERTY-level fields: name, status,
// address, units, PMS platform, and PM company — including creating a
// brand-new PMC inline (the "PM changed to a company we've never used"
// case). Building facts (year built, SF, parking, …) are owned by the
// Building tab's "Edit facts" modal — not duplicated here.

type Initial = {
  name: string
  status: Property['status']
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  units_total: number | null
  pms_platform: string | null
  pmc_id: string | null
}

const STATUSES: Property['status'][] = ['active', 'watchlist', 'disposition']
// Mirrors the settings page platform list
const PMS_PLATFORMS = ['Entrata', 'Yardi', 'ResMan', 'AIM', 'Other']
const NEW_PMC = '__new__'

export default function EditProperty({ propertyId, initial }: {
  propertyId: string
  initial: Initial
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary text-xs py-1.5 flex-shrink-0">
        <Pencil size={12} />Edit property
      </button>
      {open && (
        <EditPropertyModal propertyId={propertyId} initial={initial} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function EditPropertyModal({ propertyId, initial, onClose }: {
  propertyId: string
  initial: Initial
  onClose: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [pmcs, setPmcs] = useState<Pmc[]>([])
  const [form, setForm] = useState({
    name: initial.name,
    status: initial.status,
    address: initial.address ?? '',
    city: initial.city ?? '',
    state: initial.state ?? '',
    zip: initial.zip ?? '',
    units_total: initial.units_total == null ? '' : String(initial.units_total),
    pms_platform: initial.pms_platform ?? '',
    pmc_id: initial.pmc_id ?? '',
  })
  const [newPmc, setNewPmc] = useState({ name: '', contact_name: '', contact_email: '', contact_phone: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('pmcs').select('*').order('name').then(({ data }) => setPmcs(data ?? []))
  }, [])

  function setF(k: keyof typeof form, v: string) { setForm(f => ({ ...f, [k]: v })) }

  const creatingPmc = form.pmc_id === NEW_PMC
  const canSave = form.name.trim() !== '' && (!creatingPmc || newPmc.name.trim() !== '')

  // Keep a legacy/free-text platform value selectable even if it isn't
  // in the standard list.
  const platformOptions = form.pms_platform && !PMS_PLATFORMS.includes(form.pms_platform)
    ? [form.pms_platform, ...PMS_PLATFORMS]
    : PMS_PLATFORMS

  async function save() {
    if (!canSave || saving) return
    setSaving(true)
    setError(null)

    // New PM company first — its id feeds the property update.
    let pmcId: string | null = form.pmc_id || null
    if (creatingPmc) {
      const { data: created, error: pmcError } = await supabase.from('pmcs').insert({
        name: newPmc.name.trim(),
        primary_contact_name: newPmc.contact_name.trim() || null,
        primary_contact_email: newPmc.contact_email.trim() || null,
        primary_contact_phone: newPmc.contact_phone.trim() || null,
      }).select('id').single()
      if (pmcError || !created) {
        setSaving(false)
        setError(pmcError?.message ?? 'Could not create PM company')
        return
      }
      pmcId = created.id
    }

    const units = form.units_total.trim()
    const { error: updateError } = await supabase.from('properties').update({
      name: form.name.trim(),
      status: form.status,
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      zip: form.zip.trim() || null,
      units_total: units !== '' && Number.isFinite(Number(units)) ? Number(units) : null,
      pms_platform: form.pms_platform || null,
      pmc_id: pmcId,
    }).eq('id', propertyId)

    setSaving(false)
    if (updateError) { setError(updateError.message); return }
    toast('Property updated')
    onClose()
    // Re-render the server page (header, overview, PMC card) in place.
    router.refresh()
  }

  return (
    <Modal
      onClose={onClose}
      maxWidth="xl"
      title={
        <div className="flex items-center gap-2">
          <Pencil size={17} className="text-blue-500" />
          <div>
            <h2 className="font-semibold text-slate-900">Edit Property</h2>
            <p className="text-xs text-slate-400">Name, status, address, and PM company</p>
          </div>
        </div>
      }>
      <div className="px-6 py-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Name *</label>
            <input value={form.name} onChange={e => setF('name', e.target.value)} className="input" />
          </div>
          <div>
            <label className="label">Status</label>
            <select value={form.status} onChange={e => setF('status', e.target.value)} className="input">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Units</label>
            <input type="number" value={form.units_total} onChange={e => setF('units_total', e.target.value)} className="input" />
          </div>
          <p className="col-span-2 text-xs text-slate-400 -mt-1">
            Watchlist / disposition properties are excluded from capture and coverage checks.
          </p>
          <div className="col-span-2">
            <label className="label">Address</label>
            <input value={form.address} onChange={e => setF('address', e.target.value)} className="input" placeholder="Street address" />
          </div>
          <div>
            <label className="label">City</label>
            <input value={form.city} onChange={e => setF('city', e.target.value)} className="input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">State</label>
              <input value={form.state} onChange={e => setF('state', e.target.value)} className="input" maxLength={2} />
            </div>
            <div>
              <label className="label">ZIP</label>
              <input value={form.zip} onChange={e => setF('zip', e.target.value)} className="input" />
            </div>
          </div>
        </div>

        <div className="pt-1 space-y-3">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Property Management</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">PM Company</label>
              <select value={form.pmc_id} onChange={e => setF('pmc_id', e.target.value)} className="input">
                <option value="">None</option>
                {pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value={NEW_PMC}>+ New PM company…</option>
              </select>
            </div>
            <div>
              <label className="label">PMS Platform</label>
              <select value={form.pms_platform} onChange={e => setF('pms_platform', e.target.value)} className="input">
                <option value="">None</option>
                {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {creatingPmc && (
            <div className="p-3 border border-blue-200 bg-blue-50/30 rounded-xl space-y-3">
              <div className="text-xs font-semibold text-slate-600">New PM company</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Company Name *</label>
                  <input value={newPmc.name} autoFocus
                    onChange={e => setNewPmc(p => ({ ...p, name: e.target.value }))}
                    className="input" placeholder="e.g. New Earth Residential" />
                </div>
                <div>
                  <label className="label">Primary Contact</label>
                  <input value={newPmc.contact_name}
                    onChange={e => setNewPmc(p => ({ ...p, contact_name: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input value={newPmc.contact_phone}
                    onChange={e => setNewPmc(p => ({ ...p, contact_phone: e.target.value }))} className="input" />
                </div>
                <div className="col-span-2">
                  <label className="label">Email</label>
                  <input type="email" value={newPmc.contact_email}
                    onChange={e => setNewPmc(p => ({ ...p, contact_email: e.target.value }))} className="input" />
                </div>
              </div>
              <p className="text-xs text-slate-400">
                Created on save and assigned to this property. Fee structure and notes can be added later in Settings.
              </p>
            </div>
          )}
        </div>

        <p className="text-xs text-slate-400">
          Building facts (year built, SF, parking, unit mix) live on the{' '}
          <Link href={`/properties/${propertyId}?tab=building`} onClick={onClose}
            className="text-blue-600 hover:underline">Building tab →</Link>
        </p>
      </div>

      <div className="flex items-center gap-3 px-6 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
        <Link href="/settings?tab=pmcs" onClick={onClose}
          className="text-xs text-slate-400 hover:text-blue-600 hover:underline mr-auto">
          Manage PM companies in Settings →
        </Link>
        {error && <span className="text-xs text-red-600">Save failed — {error}</span>}
        <button onClick={onClose} className="btn-ghost">Cancel</button>
        <button onClick={save} disabled={saving || !canSave} className="btn-primary">
          {saving ? 'Saving…' : <><Check size={14} />Save changes</>}
        </button>
      </div>
    </Modal>
  )
}
