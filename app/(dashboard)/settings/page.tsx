'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Property, Pmc, Contact } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { Plus, X, Save, Building2, Users, UserCircle, ChevronDown, Check, Mail } from 'lucide-react'

const PMS_PLATFORMS = ['Entrata', 'Yardi', 'ResMan', 'AIM', 'Other']
const PROPERTY_STATUSES = ['active', 'disposition', 'watchlist']

type Tab = 'properties' | 'pmcs' | 'contacts' | 'digest'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('properties')

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'properties', label: 'Properties', icon: <Building2 size={14} /> },
    { id: 'pmcs',       label: 'PMCs',        icon: <Users size={14} /> },
    { id: 'contacts',   label: 'Contacts',    icon: <UserCircle size={14} /> },
    { id: 'digest',     label: 'Digest',      icon: <Mail size={14} /> },
  ]

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage portfolio properties, PMCs, and contacts</p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'properties' && <PropertiesTab />}
      {tab === 'pmcs' && <PmcsTab />}
      {tab === 'contacts' && <ContactsTab />}
      {tab === 'digest' && <DigestTab />}
    </div>
  )
}

// ── Properties Tab ───────────────────────────────────────────

function PropertiesTab() {
  const supabase = createClient()
  const [properties, setProperties] = useState<Property[]>([])
  const [pmcs, setPmcs] = useState<Pmc[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<Property>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', address: '', city: '', state: 'CO', zip: '', units_total: '', pmc_id: '', pms_platform: '', status: 'active' })
  const [addSaving, setAddSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    const [{ data: props }, { data: p }] = await Promise.all([
      (supabase.from('properties') as any).select('*').order('name'),
      supabase.from('pmcs').select('*').order('name'),
    ])
    setProperties(props ?? [])
    setPmcs(p ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  function startEdit(p: Property) {
    setEditing(p.id)
    setDrafts(d => ({ ...d, [p.id]: { ...p } }))
  }

  function updateDraft(id: string, key: string, value: string) {
    setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: value || null } }))
  }

  async function saveProperty(id: string) {
    setSaving(id)
    const draft = drafts[id]
    await (supabase.from('properties') as any).update({
      name: draft.name,
      address: draft.address,
      city: draft.city,
      state: draft.state,
      zip: draft.zip,
      units_total: draft.units_total ? parseInt(draft.units_total as any) : null,
      pmc_id: draft.pmc_id || null,
      pms_platform: draft.pms_platform || null,
      status: draft.status,
      notes: (draft as any).notes || null,
    }).eq('id', id)
    setSaving(null)
    setEditing(null)
    setSaved(id)
    setTimeout(() => setSaved(null), 2000)
    fetch()
  }

  async function addProperty() {
    if (!addForm.name) return
    setAddSaving(true)
    await (supabase.from('properties') as any).insert({
      name: addForm.name,
      address: addForm.address || null,
      city: addForm.city || null,
      state: addForm.state || null,
      zip: addForm.zip || null,
      units_total: addForm.units_total ? parseInt(addForm.units_total) : null,
      pmc_id: addForm.pmc_id || null,
      pms_platform: addForm.pms_platform || null,
      status: addForm.status,
    })
    setAddSaving(false)
    setShowAdd(false)
    setAddForm({ name: '', address: '', city: '', state: 'CO', zip: '', units_total: '', pmc_id: '', pms_platform: '', status: 'active' })
    fetch()
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={14} />Add Property</button>
      </div>

      {showAdd && (
        <div className="card p-5 border-blue-200 bg-blue-50/30 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">New Property</h3>
            <button onClick={() => setShowAdd(false)}><X size={16} className="text-slate-400" /></button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1"><label className="label">Name *</label><input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="Property name" /></div>
            <div><label className="label">Units</label><input type="number" value={addForm.units_total} onChange={e => setAddForm(f => ({ ...f, units_total: e.target.value }))} className="input" placeholder="0" /></div>
            <div><label className="label">Status</label><select value={addForm.status} onChange={e => setAddForm(f => ({ ...f, status: e.target.value }))} className="input">{PROPERTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
            <div className="col-span-2"><label className="label">Address</label><input value={addForm.address} onChange={e => setAddForm(f => ({ ...f, address: e.target.value }))} className="input" placeholder="Street address" /></div>
            <div><label className="label">City</label><input value={addForm.city} onChange={e => setAddForm(f => ({ ...f, city: e.target.value }))} className="input" /></div>
            <div><label className="label">State</label><input value={addForm.state} onChange={e => setAddForm(f => ({ ...f, state: e.target.value }))} className="input" maxLength={2} /></div>
            <div><label className="label">ZIP</label><input value={addForm.zip} onChange={e => setAddForm(f => ({ ...f, zip: e.target.value }))} className="input" /></div>
            <div><label className="label">PMC</label><select value={addForm.pmc_id} onChange={e => setAddForm(f => ({ ...f, pmc_id: e.target.value }))} className="input"><option value="">None</option>{pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">PMS Platform</label><select value={addForm.pms_platform} onChange={e => setAddForm(f => ({ ...f, pms_platform: e.target.value }))} className="input"><option value="">None</option>{PMS_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button>
            <button onClick={addProperty} disabled={addSaving || !addForm.name} className="btn-primary">{addSaving ? 'Adding…' : 'Add Property'}</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Property</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Address</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Units</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">PMC</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">PMS</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Status</th>
              <th className="w-28" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {properties.map(prop => {
              const isEditing = editing === prop.id
              const draft = drafts[prop.id] ?? prop
              const isSaving = saving === prop.id
              const justSaved = saved === prop.id

              return (
                <tr key={prop.id} className={cn('group', isEditing ? 'bg-blue-50/40' : 'hover:bg-slate-50')}>
                  <td className="px-4 py-2.5">
                    {isEditing
                      ? <input value={(draft as any).name ?? ''} onChange={e => updateDraft(prop.id, 'name', e.target.value)} className="input-sm w-full" />
                      : <div className="font-medium text-slate-900">{prop.name}</div>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <input value={(draft as any).city ?? ''} onChange={e => updateDraft(prop.id, 'city', e.target.value)} className="input-sm w-24" placeholder="City" />
                        <input value={(draft as any).state ?? ''} onChange={e => updateDraft(prop.id, 'state', e.target.value)} className="input-sm w-10" placeholder="ST" maxLength={2} />
                      </div>
                    ) : (
                      <span className="text-slate-500 text-xs">{prop.city}{prop.state ? `, ${prop.state}` : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing
                      ? <input type="number" value={(draft as any).units_total ?? ''} onChange={e => updateDraft(prop.id, 'units_total', e.target.value)} className="input-sm w-16" />
                      : <span className="text-slate-600 text-xs">{prop.units_total ?? '—'}</span>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing
                      ? <select value={(draft as any).pmc_id ?? ''} onChange={e => updateDraft(prop.id, 'pmc_id', e.target.value)} className="input-sm w-36">
                          <option value="">None</option>
                          {pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      : <span className="text-slate-600 text-xs">{pmcs.find(p => p.id === prop.pmc_id)?.name ?? '—'}</span>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing
                      ? <select value={(draft as any).pms_platform ?? ''} onChange={e => updateDraft(prop.id, 'pms_platform', e.target.value)} className="input-sm w-28">
                          <option value="">None</option>
                          {PMS_PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      : <span className="text-slate-500 text-xs">{prop.pms_platform ?? '—'}</span>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing
                      ? <select value={(draft as any).status ?? 'active'} onChange={e => updateDraft(prop.id, 'status', e.target.value)} className="input-sm w-28">
                          {PROPERTY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      : <span className={cn('badge text-xs', prop.status === 'active' ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : prop.status === 'watchlist' ? 'text-amber-700 bg-amber-50 border-amber-200' : 'text-slate-500 bg-slate-50 border-slate-200')}>{prop.status}</span>
                    }
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      {isEditing ? (
                        <>
                          <button onClick={() => setEditing(null)} className="btn-ghost text-xs py-1 px-2">Cancel</button>
                          <button onClick={() => saveProperty(prop.id)} disabled={isSaving}
                            className="btn-primary text-xs py-1 px-2">
                            {isSaving ? '…' : <><Save size={11} />Save</>}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => startEdit(prop)}
                          className="opacity-0 group-hover:opacity-100 text-xs text-blue-600 hover:text-blue-700 transition-opacity px-2 py-1 rounded hover:bg-blue-50">
                          {justSaved ? <span className="flex items-center gap-1 text-emerald-600"><Check size={11} />Saved</span> : 'Edit'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── PMCs Tab ─────────────────────────────────────────────────

function PmcsTab() {
  const supabase = createClient()
  const [pmcs, setPmcs] = useState<Pmc[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Partial<Pmc>>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', primary_contact_name: '', primary_contact_email: '', primary_contact_phone: '', fee_structure: '', notes: '' })

  const fetch = useCallback(async () => {
    const { data } = await supabase.from('pmcs').select('*').order('name')
    setPmcs(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function save(id: string) {
    setSaving(id)
    const d = drafts[id]
    await (supabase.from('pmcs') as any).update({ name: d.name, primary_contact_name: d.primary_contact_name, primary_contact_email: d.primary_contact_email, primary_contact_phone: d.primary_contact_phone, fee_structure: d.fee_structure, notes: (d as any).notes }).eq('id', id)
    setSaving(null); setEditing(null); fetch()
  }

  async function addPmc() {
    if (!addForm.name) return
    await (supabase.from('pmcs') as any).insert({ name: addForm.name, primary_contact_name: addForm.primary_contact_name || null, primary_contact_email: addForm.primary_contact_email || null, primary_contact_phone: addForm.primary_contact_phone || null, fee_structure: addForm.fee_structure || null, notes: addForm.notes || null })
    setShowAdd(false); setAddForm({ name: '', primary_contact_name: '', primary_contact_email: '', primary_contact_phone: '', fee_structure: '', notes: '' }); fetch()
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setShowAdd(true)} className="btn-primary"><Plus size={14} />Add PMC</button>
      </div>

      {showAdd && (
        <div className="card p-5 border-blue-200 bg-blue-50/30 space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-700">New PMC</h3><button onClick={() => setShowAdd(false)}><X size={16} className="text-slate-400" /></button></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Name *</label><input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="input" /></div>
            <div><label className="label">Primary Contact</label><input value={addForm.primary_contact_name} onChange={e => setAddForm(f => ({ ...f, primary_contact_name: e.target.value }))} className="input" /></div>
            <div><label className="label">Phone</label><input value={addForm.primary_contact_phone} onChange={e => setAddForm(f => ({ ...f, primary_contact_phone: e.target.value }))} className="input" /></div>
            <div className="col-span-2"><label className="label">Email</label><input value={addForm.primary_contact_email} onChange={e => setAddForm(f => ({ ...f, primary_contact_email: e.target.value }))} className="input" /></div>
            <div className="col-span-2"><label className="label">Fee Structure</label><input value={addForm.fee_structure} onChange={e => setAddForm(f => ({ ...f, fee_structure: e.target.value }))} className="input" placeholder="e.g. 8% gross revenue" /></div>
          </div>
          <div className="flex justify-end gap-2"><button onClick={() => setShowAdd(false)} className="btn-ghost">Cancel</button><button onClick={addPmc} disabled={!addForm.name} className="btn-primary">Add PMC</button></div>
        </div>
      )}

      <div className="space-y-3">
        {pmcs.map(pmc => {
          const isEditing = editing === pmc.id
          const d = drafts[pmc.id] ?? pmc
          return (
            <div key={pmc.id} className={cn('card p-4', isEditing && 'border-blue-200 bg-blue-50/30')}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div><label className="label">Name *</label><input value={(d as any).name ?? ''} onChange={e => setDrafts(dr => ({ ...dr, [pmc.id]: { ...dr[pmc.id], name: e.target.value } }))} className="input" /></div>
                        <div><label className="label">Primary Contact</label><input value={(d as any).primary_contact_name ?? ''} onChange={e => setDrafts(dr => ({ ...dr, [pmc.id]: { ...dr[pmc.id], primary_contact_name: e.target.value } }))} className="input" /></div>
                        <div><label className="label">Email</label><input value={(d as any).primary_contact_email ?? ''} onChange={e => setDrafts(dr => ({ ...dr, [pmc.id]: { ...dr[pmc.id], primary_contact_email: e.target.value } }))} className="input" /></div>
                        <div><label className="label">Phone</label><input value={(d as any).primary_contact_phone ?? ''} onChange={e => setDrafts(dr => ({ ...dr, [pmc.id]: { ...dr[pmc.id], primary_contact_phone: e.target.value } }))} className="input" /></div>
                        <div className="col-span-2"><label className="label">Fee Structure</label><input value={(d as any).fee_structure ?? ''} onChange={e => setDrafts(dr => ({ ...dr, [pmc.id]: { ...dr[pmc.id], fee_structure: e.target.value } }))} className="input" /></div>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="font-medium text-slate-900">{pmc.name}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{pmc.primary_contact_name ?? 'No contact set'}</div>
                      {pmc.primary_contact_email && <div className="text-xs text-slate-400">{pmc.primary_contact_email}</div>}
                      {pmc.primary_contact_phone && <div className="text-xs text-slate-400">{pmc.primary_contact_phone}</div>}
                      {pmc.fee_structure && <div className="text-xs text-slate-400 mt-1">{pmc.fee_structure}</div>}
                    </div>
                  )}
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <button onClick={() => setEditing(null)} className="btn-ghost text-xs py-1.5">Cancel</button>
                      <button onClick={() => save(pmc.id)} disabled={saving === pmc.id} className="btn-primary text-xs py-1.5">
                        {saving === pmc.id ? '…' : <><Save size={12} />Save</>}
                      </button>
                    </>
                  ) : (
                    <button onClick={() => { setEditing(pmc.id); setDrafts(d => ({ ...d, [pmc.id]: { ...pmc } })) }}
                      className="btn-secondary text-xs py-1.5">Edit</button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Contacts Tab ─────────────────────────────────────────────

function ContactsTab() {
  const supabase = createClient()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [pmcs, setPmcs] = useState<Pmc[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editContact, setEditContact] = useState<Contact | null>(null)

  const fetch = useCallback(async () => {
    const [{ data: c }, { data: p }] = await Promise.all([
      supabase.from('contacts').select('*').order('full_name'),
      supabase.from('pmcs').select('*').order('name'),
    ])
    setContacts(c ?? [])
    setPmcs(p ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  async function deleteContact(id: string) {
    if (!confirm('Delete this contact?')) return
    await supabase.from('contacts').delete().eq('id', id)
    fetch()
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => { setEditContact(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />Add Contact</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Name</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Role</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">PMC</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Email</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-slate-500">Phone</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {contacts.map(c => (
              <tr key={c.id} className="hover:bg-slate-50 group">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                      style={{ background: c.color_hex ?? '#64748b' }}>
                      {c.initials ?? c.full_name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="font-medium text-slate-900">{c.full_name}</span>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{c.role ?? '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{pmcs.find(p => p.id === c.pmc_id)?.name ?? '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{c.email ?? '—'}</td>
                <td className="px-3 py-2.5 text-xs text-slate-500">{c.phone ?? '—'}</td>
                <td className="px-3 py-2.5">
                  <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => { setEditContact(c); setShowForm(true) }} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                    <button onClick={() => deleteContact(c.id)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ContactFormModal
          contact={editContact}
          pmcs={pmcs}
          onClose={() => { setShowForm(false); setEditContact(null) }}
          onSave={() => { setShowForm(false); setEditContact(null); fetch() }}
        />
      )}
    </div>
  )
}

function ContactFormModal({ contact, pmcs, onClose, onSave }: {
  contact: Contact | null; pmcs: Pmc[]; onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const [form, setForm] = useState({
    full_name: contact?.full_name ?? '',
    initials:  contact?.initials ?? '',
    role:      contact?.role ?? '',
    email:     contact?.email ?? '',
    phone:     contact?.phone ?? '',
    pmc_id:    contact?.pmc_id ?? '',
    color_hex: contact?.color_hex ?? '#64748b',
  })
  const [saving, setSaving] = useState(false)

  const COLORS = ['#1D9E75','#D85A30','#7F77DD','#BA7517','#378ADD','#6366f1','#ec4899','#64748b']

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true)
    const payload: any = { full_name: form.full_name, initials: form.initials || form.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(), role: form.role || null, email: form.email || null, phone: form.phone || null, pmc_id: form.pmc_id || null, color_hex: form.color_hex }
    if (contact) await (supabase.from('contacts') as any).update(payload).eq('id', contact.id)
    else await (supabase.from('contacts') as any).insert(payload)
    setSaving(false); onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold">{contact ? 'Edit Contact' : 'New Contact'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Full Name *</label><input required value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))} className="input" /></div>
            <div><label className="label">Initials</label><input value={form.initials} onChange={e => setForm(f => ({ ...f, initials: e.target.value }))} className="input" maxLength={3} placeholder="Auto" /></div>
            <div><label className="label">PMC</label><select value={form.pmc_id} onChange={e => setForm(f => ({ ...f, pmc_id: e.target.value }))} className="input"><option value="">None</option>{pmcs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div className="col-span-2"><label className="label">Role</label><input value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="input" placeholder="e.g. Property Manager · GBC" /></div>
            <div><label className="label">Email</label><input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="input" /></div>
            <div><label className="label">Phone</label><input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} className="input" /></div>
          </div>
          <div>
            <label className="label">Avatar Color</label>
            <div className="flex gap-2 mt-1">
              {COLORS.map(color => (
                <button key={color} type="button" onClick={() => setForm(f => ({ ...f, color_hex: color }))}
                  className={cn('w-7 h-7 rounded-full transition-transform', form.color_hex === color && 'ring-2 ring-offset-2 ring-slate-400 scale-110')}
                  style={{ background: color }} />
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving || !form.full_name} className="btn-primary">{saving ? 'Saving…' : contact ? 'Save' : 'Add contact'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Digest Tab ───────────────────────────────────────────────

function DigestTab() {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; message?: string; sections?: any } | null>(null)

  async function sendTestDigest() {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/digest', {
        headers: { authorization: `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET ?? ''}` }
      })
      const data = await res.json()
      if (data.success) {
        setResult({ success: true, message: `Sent to ${data.sent_to}`, sections: data.sections })
      } else {
        setResult({ success: false, message: data.error ?? 'Unknown error' })
      }
    } catch (err: any) {
      setResult({ success: false, message: err.message })
    }
    setSending(false)
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Weekly Digest Configuration</h3>
        <div className="space-y-3 text-sm text-slate-600">
          {[
            ['Schedule', 'Every Sunday at 6pm MT (Monday 1am UTC)'],
            ['Recipient', 'nick@c2cpllc.com'],
            ['Gmail scan', 'Snoozed emails due this week + unanswered threads expecting a reply'],
            ['Platform items', 'Urgent/high tasks · Expiring insurance (≤60d) · Contract deadlines (≤60d) · Claims due this week'],
          ].map(([label, value]) => (
            <div key={label} className="flex gap-3">
              <span className="w-32 flex-shrink-0 text-slate-400 font-medium">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Send Test Digest</h3>
        <p className="text-sm text-slate-500">Triggers the digest immediately — useful for verifying your Resend API key and Gmail connection are working.</p>
        <button onClick={sendTestDigest} disabled={sending} className="btn-primary">
          <Mail size={14} />
          {sending ? 'Sending…' : 'Send test digest now'}
        </button>
        {result && (
          <div className={cn('p-3 rounded-lg text-sm', result.success ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200')}>
            {result.success ? '✓ ' : '✗ '}{result.message}
            {result.sections && (
              <div className="mt-2 text-xs space-y-0.5 opacity-80">
                {Object.entries(result.sections).map(([k, v]) => (
                  <div key={k}>{k.replace(/_/g, ' ')}: {v as number}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-slate-700">Required Environment Variables</h3>
        <p className="text-sm text-slate-500">Add these in Vercel → Settings → Environment Variables if not already set:</p>
        <div className="space-y-2">
          {[
            { name: 'RESEND_API_KEY', desc: 'From resend.com → API Keys', required: true },
            { name: 'NEXT_PUBLIC_APP_URL', desc: 'Your Vercel deployment URL (for links in email)', required: false },
          ].map(({ name, desc, required }) => (
            <div key={name} className="flex items-start gap-3 p-2.5 bg-slate-50 rounded-lg">
              <code className="text-xs font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded flex-shrink-0">{name}</code>
              <span className="text-xs text-slate-500">{desc}</span>
              {required && <span className="text-xs text-red-500 font-medium flex-shrink-0 ml-auto">Required</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
