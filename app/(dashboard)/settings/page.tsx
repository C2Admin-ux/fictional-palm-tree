'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { AlertSetting, Json, Property, Pmc, Contact } from '@/lib/supabase/types'
import { cn } from '@/lib/utils'
import { Plus, X, Save, Building2, Users, UserCircle, ChevronDown, Check, Mail, Bell } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import {
  OBLIGATION_LEAD_DAYS_KEY, SEASONS, formatMonthDay, parseMonthDay,
  resolveSeasonConfig, type SeasonSpec,
} from '@/lib/tasks/seasonal'

const PMS_PLATFORMS = ['Entrata', 'Yardi', 'ResMan', 'AIM', 'Other']
const PROPERTY_STATUSES = ['active', 'disposition', 'watchlist']

type Tab = 'properties' | 'pmcs' | 'contacts' | 'alerts' | 'digest'

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('properties')

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'properties', label: 'Properties', icon: <Building2 size={14} /> },
    { id: 'pmcs',       label: 'PMCs',        icon: <Users size={14} /> },
    { id: 'contacts',   label: 'Contacts',    icon: <UserCircle size={14} /> },
    { id: 'alerts',     label: 'Alerts',      icon: <Bell size={14} /> },
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
      {tab === 'alerts' && <AlertsTab />}
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
      supabase.from('properties').select('*').order('name'),
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
    await supabase.from('properties').update({
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
    await supabase.from('properties').insert({
      name: addForm.name,
      address: addForm.address || null,
      city: addForm.city || null,
      state: addForm.state || null,
      zip: addForm.zip || null,
      units_total: addForm.units_total ? parseInt(addForm.units_total) : null,
      pmc_id: addForm.pmc_id || null,
      pms_platform: addForm.pms_platform || null,
      status: addForm.status as Property['status'],
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
    await supabase.from('pmcs').update({ name: d.name, primary_contact_name: d.primary_contact_name, primary_contact_email: d.primary_contact_email, primary_contact_phone: d.primary_contact_phone, fee_structure: d.fee_structure, notes: (d as any).notes }).eq('id', id)
    setSaving(null); setEditing(null); fetch()
  }

  async function addPmc() {
    if (!addForm.name) return
    await supabase.from('pmcs').insert({ name: addForm.name, primary_contact_name: addForm.primary_contact_name || null, primary_contact_email: addForm.primary_contact_email || null, primary_contact_phone: addForm.primary_contact_phone || null, fee_structure: addForm.fee_structure || null, notes: addForm.notes || null })
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
    if (contact) await supabase.from('contacts').update(payload).eq('id', contact.id)
    else await supabase.from('contacts').insert(payload)
    setSaving(false); onSave()
  }

  return (
    <Modal title={contact ? 'Edit Contact' : 'New Contact'} onClose={onClose} maxWidth="md">
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
    </Modal>
  )
}

// ── Alerts Tab ───────────────────────────────────────────────
// alert_settings (migration 0007) editor for the obligations engine:
// global obligation lead time, global seasonal bid windows, and
// per-property window overrides (thin markets like Casper start the
// snow bid cycle earlier; in-house crews disable a property's cycle).
// Blank date fields inherit the next layer (global → code defaults) —
// the engine parses every value defensively, so nothing here can break
// the nightly cron.

const DEFAULT_LEAD_DAYS = 120
type CycleDraft = { enabled: boolean; start: string; due: string; end: string }

function cycleDraftFrom(value: unknown): CycleDraft {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>
  return {
    enabled: v.enabled !== false,
    start: typeof v.start === 'string' ? v.start : '',
    due: typeof v.due === 'string' ? v.due : '',
    end: typeof v.end === 'string' ? v.end : '',
  }
}

/** Draft → jsonb value; blank dates are omitted so the engine inherits. */
function cycleValueFrom(d: CycleDraft): Json {
  const value: { [key: string]: Json } = { enabled: d.enabled }
  if (d.start.trim()) value.start = d.start.trim()
  if (d.due.trim()) value.due = d.due.trim()
  if (d.end.trim()) value.end = d.end.trim()
  return value
}

/** Validate a draft against the window it inherits from. Null = OK. */
function cycleDraftError(d: CycleDraft, inherited: { start: string; due: string; end: string }): string | null {
  for (const field of ['start', 'due', 'end'] as const) {
    const v = d[field].trim()
    if (v && !parseMonthDay(v)) return `"${v}" isn't a valid MM-DD date (e.g. 09-01)`
  }
  const eff = (field: 'start' | 'due' | 'end') => d[field].trim() || inherited[field]
  if (!(eff('start') <= eff('due') && eff('due') <= eff('end')))
    return 'Dates must be in calendar order: start ≤ due ≤ season end (within one calendar year)'
  return null
}

function rowFor(rows: AlertSetting[], key: string, propertyId: string | null) {
  return rows.find(s => s.setting_key === key && s.property_id === propertyId)
}

function AlertsTab() {
  const supabase = createClient()
  const [settings, setSettings] = useState<AlertSetting[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [leadDraft, setLeadDraft] = useState('')
  const [cycleDrafts, setCycleDrafts] = useState<Record<string, CycleDraft>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showAdd, setShowAdd] = useState(false)
  const [editOverride, setEditOverride] = useState<AlertSetting | null>(null)

  const fetch = useCallback(async () => {
    const [{ data: rows }, { data: props }] = await Promise.all([
      supabase.from('alert_settings').select('*').order('setting_key'),
      supabase.from('properties').select('*').order('name'),
    ])
    const all = rows ?? []
    setSettings(all)
    setProperties(props ?? [])
    const lead = rowFor(all, OBLIGATION_LEAD_DAYS_KEY, null)?.value as { days?: number } | undefined
    setLeadDraft(lead?.days != null ? String(lead.days) : '')
    setCycleDrafts(Object.fromEntries(
      SEASONS.map(s => [s.setting_key, cycleDraftFrom(rowFor(all, s.setting_key, null)?.value)])
    ))
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  function flash(key: string) {
    setSaved(key)
    setTimeout(() => setSaved(s => (s === key ? null : s)), 2000)
  }

  function clearError(key: string) {
    setErrors(e => {
      if (!(key in e)) return e
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  /** Insert-or-update one (setting_key, property) row — no ON CONFLICT
   * because the uniqueness lives in partial indexes. Low-traffic surface;
   * a race just surfaces the unique-violation error. */
  async function writeSetting(key: string, propertyId: string | null, value: Json) {
    const existing = rowFor(settings, key, propertyId)
    const res = existing
      ? await supabase.from('alert_settings').update({ value, updated_at: new Date().toISOString() }).eq('id', existing.id)
      : await supabase.from('alert_settings').insert({ setting_key: key, property_id: propertyId, value })
    if (res.error) throw new Error(res.error.message)
  }

  async function saveLeadDays() {
    const raw = leadDraft.trim()
    const days = Number(raw)
    if (raw && (!Number.isInteger(days) || days < 1 || days > 365)) {
      setErrors(e => ({ ...e, lead: 'Enter a whole number of days between 1 and 365' }))
      return
    }
    clearError('lead')
    setSaving('lead')
    try {
      const existing = rowFor(settings, OBLIGATION_LEAD_DAYS_KEY, null)
      if (!raw) {
        // Blank = back to the code default; drop the row entirely.
        if (existing) {
          const { error } = await supabase.from('alert_settings').delete().eq('id', existing.id)
          if (error) throw new Error(error.message)
        }
      } else {
        await writeSetting(OBLIGATION_LEAD_DAYS_KEY, null, { days })
      }
      await fetch()
      flash('lead')
    } catch (err: any) {
      setErrors(e => ({ ...e, lead: err.message }))
    }
    setSaving(null)
  }

  async function saveGlobalCycle(spec: SeasonSpec) {
    const draft = cycleDrafts[spec.setting_key]
    if (!draft) return
    const defaults = { start: formatMonthDay(spec.start), due: formatMonthDay(spec.due), end: formatMonthDay(spec.seasonEnd) }
    const problem = cycleDraftError(draft, defaults)
    if (problem) {
      setErrors(e => ({ ...e, [spec.setting_key]: problem }))
      return
    }
    clearError(spec.setting_key)
    setSaving(spec.setting_key)
    try {
      await writeSetting(spec.setting_key, null, cycleValueFrom(draft))
      await fetch()
      flash(spec.setting_key)
    } catch (err: any) {
      setErrors(e => ({ ...e, [spec.setting_key]: err.message }))
    }
    setSaving(null)
  }

  async function deleteOverride(row: AlertSetting) {
    if (!confirm('Remove this override? The property goes back to the global window.')) return
    await supabase.from('alert_settings').delete().eq('id', row.id)
    fetch()
  }

  /** Effective window a property override inherits: global row → defaults. */
  function inheritedWindow(spec: SeasonSpec) {
    const cfg = resolveSeasonConfig(spec, rowFor(settings, spec.setting_key, null)?.value, undefined)
    return { start: formatMonthDay(cfg.start), due: formatMonthDay(cfg.due), end: formatMonthDay(cfg.seasonEnd) }
  }

  const overrides = settings
    .filter(s => s.property_id != null && SEASONS.some(sp => sp.setting_key === s.setting_key))
    .sort((a, b) => (propName(a.property_id) + a.setting_key).localeCompare(propName(b.property_id) + b.setting_key))

  function propName(id: string | null) {
    return properties.find(p => p.id === id)?.name ?? '(unknown property)'
  }
  function specFor(key: string) {
    return SEASONS.find(s => s.setting_key === key)
  }

  if (loading) return <div className="py-12 text-center text-sm text-slate-400">Loading…</div>

  return (
    <div className="space-y-5">
      {/* Global: obligation lead time */}
      <div className="card p-5 space-y-3 max-w-2xl">
        <h3 className="text-sm font-semibold text-slate-700">Obligation lead time</h3>
        <p className="text-sm text-slate-500">How far ahead insurance/contract deadline tasks are created. Leave blank for the default ({DEFAULT_LEAD_DAYS} days).</p>
        <div className="flex items-center gap-2">
          <input type="number" min={1} max={365} value={leadDraft}
            onChange={e => setLeadDraft(e.target.value)}
            className="input w-28" placeholder={String(DEFAULT_LEAD_DAYS)} />
          <span className="text-sm text-slate-500">days</span>
          <button onClick={saveLeadDays} disabled={saving === 'lead'} className="btn-primary text-xs py-1.5 ml-2">
            {saving === 'lead' ? '…' : <><Save size={12} />Save</>}
          </button>
          {saved === 'lead' && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={11} />Saved</span>}
        </div>
        {errors.lead && <p className="text-xs text-red-600">{errors.lead}</p>}
      </div>

      {/* Global: seasonal bid windows */}
      <div className="card p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Seasonal bid cycles — global defaults</h3>
          <p className="text-sm text-slate-500 mt-0.5">When &quot;gather bids&quot; tasks appear (start), are due, and stop being created (season end). Dates are MM-DD; blank fields keep the built-in default shown in the box.</p>
        </div>
        <div className="space-y-3">
          {SEASONS.map(spec => {
            const d = cycleDrafts[spec.setting_key] ?? cycleDraftFrom(undefined)
            const set = (patch: Partial<CycleDraft>) =>
              setCycleDrafts(c => ({ ...c, [spec.setting_key]: { ...d, ...patch } }))
            return (
              <div key={spec.setting_key} className="flex flex-wrap items-end gap-3 p-3 bg-slate-50 rounded-lg">
                <div className="w-32 pb-2">
                  <div className="text-sm font-medium text-slate-700 capitalize">{spec.label}</div>
                  <label className="flex items-center gap-1.5 mt-1 text-xs text-slate-500 cursor-pointer">
                    <input type="checkbox" checked={d.enabled} onChange={e => set({ enabled: e.target.checked })} className="w-3.5 h-3.5" />
                    Enabled
                  </label>
                </div>
                <div><label className="label">Start</label>
                  <input value={d.start} onChange={e => set({ start: e.target.value })} disabled={!d.enabled}
                    className="input-sm w-20 disabled:opacity-50" placeholder={formatMonthDay(spec.start)} maxLength={5} /></div>
                <div><label className="label">Due</label>
                  <input value={d.due} onChange={e => set({ due: e.target.value })} disabled={!d.enabled}
                    className="input-sm w-20 disabled:opacity-50" placeholder={formatMonthDay(spec.due)} maxLength={5} /></div>
                <div><label className="label">Season end</label>
                  <input value={d.end} onChange={e => set({ end: e.target.value })} disabled={!d.enabled}
                    className="input-sm w-20 disabled:opacity-50" placeholder={formatMonthDay(spec.seasonEnd)} maxLength={5} /></div>
                <div className="flex items-center gap-2 pb-0.5">
                  <button onClick={() => saveGlobalCycle(spec)} disabled={saving === spec.setting_key} className="btn-primary text-xs py-1.5">
                    {saving === spec.setting_key ? '…' : <><Save size={12} />Save</>}
                  </button>
                  {saved === spec.setting_key && <span className="flex items-center gap-1 text-xs text-emerald-600"><Check size={11} />Saved</span>}
                </div>
                {errors[spec.setting_key] && <p className="w-full text-xs text-red-600">{errors[spec.setting_key]}</p>}
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-property overrides */}
      <div className="card p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Per-property overrides</h3>
            <p className="text-sm text-slate-500 mt-0.5">Thin vendor markets (e.g. Casper) can start a bid cycle earlier; properties handling work in-house can turn a cycle off.</p>
          </div>
          <button onClick={() => { setEditOverride(null); setShowAdd(true) }} className="btn-primary flex-shrink-0"><Plus size={14} />Add override</button>
        </div>

        {(showAdd || editOverride) && (
          <OverrideForm
            key={editOverride?.id ?? 'new'}
            existing={editOverride}
            properties={properties}
            takenKeys={overrides.map(o => `${o.setting_key}:${o.property_id}`)}
            inheritedWindow={inheritedWindow}
            onCancel={() => { setShowAdd(false); setEditOverride(null) }}
            onSave={async (key, propertyId, value) => {
              await writeSetting(key, propertyId, value)
              setShowAdd(false); setEditOverride(null)
              await fetch()
            }}
          />
        )}

        {overrides.length === 0 && !showAdd
          ? <p className="text-sm text-slate-400 py-2">No overrides yet — every property uses the global windows above.</p>
          : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Property</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Cycle</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Enabled</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Start</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Due</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-slate-500">Season end</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {overrides.map(row => {
                  const d = cycleDraftFrom(row.value)
                  const spec = specFor(row.setting_key)
                  return (
                    <tr key={row.id} className="hover:bg-slate-50 group">
                      <td className="px-3 py-2 font-medium text-slate-900">{propName(row.property_id)}</td>
                      <td className="px-3 py-2 text-slate-600 capitalize">{spec?.label ?? row.setting_key}</td>
                      <td className="px-3 py-2">
                        {d.enabled
                          ? <span className="badge text-xs text-emerald-700 bg-emerald-50 border-emerald-200">on</span>
                          : <span className="badge text-xs text-slate-500 bg-slate-50 border-slate-200">off</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{d.start || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{d.due || '—'}</td>
                      <td className="px-3 py-2 text-xs text-slate-600 font-mono">{d.end || '—'}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => { setShowAdd(false); setEditOverride(row) }} className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                          <button onClick={() => deleteOverride(row)} className="text-xs text-red-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )
}

function OverrideForm({ existing, properties, takenKeys, inheritedWindow, onCancel, onSave }: {
  existing: AlertSetting | null
  properties: Property[]
  takenKeys: string[]
  inheritedWindow: (spec: SeasonSpec) => { start: string; due: string; end: string }
  onCancel: () => void
  onSave: (key: string, propertyId: string, value: Json) => Promise<void>
}) {
  const [propertyId, setPropertyId] = useState(existing?.property_id ?? '')
  const [settingKey, setSettingKey] = useState(existing?.setting_key ?? SEASONS[0].setting_key)
  const [draft, setDraft] = useState<CycleDraft>(cycleDraftFrom(existing?.value))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const spec = SEASONS.find(s => s.setting_key === settingKey) ?? SEASONS[0]
  const inherited = inheritedWindow(spec)

  async function save() {
    if (!propertyId) { setError('Pick a property'); return }
    if (!existing && takenKeys.includes(`${settingKey}:${propertyId}`)) {
      setError('That property already has an override for this cycle — edit it instead')
      return
    }
    const problem = cycleDraftError(draft, inherited)
    if (problem) { setError(problem); return }
    setError(null)
    setSaving(true)
    try {
      await onSave(settingKey, propertyId, cycleValueFrom(draft))
    } catch (err: any) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="card p-4 border-blue-200 bg-blue-50/30 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">{existing ? 'Edit override' : 'New override'}</h4>
        <button onClick={onCancel}><X size={16} className="text-slate-400" /></button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">Property *</label>
          <select value={propertyId} onChange={e => setPropertyId(e.target.value)} disabled={!!existing} className="input-sm w-44 disabled:opacity-60">
            <option value="">Select…</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div><label className="label">Cycle</label>
          <select value={settingKey} onChange={e => setSettingKey(e.target.value)} disabled={!!existing} className="input-sm w-36 capitalize disabled:opacity-60">
            {SEASONS.map(s => <option key={s.setting_key} value={s.setting_key}>{s.label}</option>)}
          </select></div>
        <div className="pb-1.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={draft.enabled} onChange={e => setDraft(d => ({ ...d, enabled: e.target.checked }))} className="w-3.5 h-3.5" />
            Enabled
          </label>
        </div>
        <div><label className="label">Start</label>
          <input value={draft.start} onChange={e => setDraft(d => ({ ...d, start: e.target.value }))} disabled={!draft.enabled}
            className="input-sm w-20 disabled:opacity-50" placeholder={inherited.start} maxLength={5} /></div>
        <div><label className="label">Due</label>
          <input value={draft.due} onChange={e => setDraft(d => ({ ...d, due: e.target.value }))} disabled={!draft.enabled}
            className="input-sm w-20 disabled:opacity-50" placeholder={inherited.due} maxLength={5} /></div>
        <div><label className="label">Season end</label>
          <input value={draft.end} onChange={e => setDraft(d => ({ ...d, end: e.target.value }))} disabled={!draft.enabled}
            className="input-sm w-20 disabled:opacity-50" placeholder={inherited.end} maxLength={5} /></div>
      </div>
      <p className="text-xs text-slate-400">Blank date fields inherit the global window ({inherited.start} → due {inherited.due} → ends {inherited.end}). Dates are MM-DD.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : existing ? 'Save' : 'Add override'}</button>
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
      // POST + session cookie: the digest route's browser path is POST-only
      // (a session-authed GET would be CSRF-triggerable cross-site) and the
      // cron secret is never shipped to the browser.
      const res = await fetch('/api/digest', { method: 'POST' })
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
            ['Schedule', 'ON HOLD — automatic Sunday digest is paused (cron removed from vercel.json); manual send below still works'],
            ['Recipient', 'DIGEST_EMAIL env var (defaults to nick@c2cpllc.com)'],
            ['Gmail scan', 'OFF — disabled until a Gmail MCP credential is set up (see GMAIL_SCAN_ENABLED in api/digest)'],
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
        <p className="text-sm text-slate-500">Triggers the digest immediately — useful for verifying your Resend API key is working. (Gmail scan is currently disabled, so that section will be empty.)</p>
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
            { name: 'CRON_SECRET', desc: 'Long random string — auths the Vercel cron calls (server-only)', required: true },
            { name: 'ANTHROPIC_API_KEY', desc: 'From console.anthropic.com — powers the document OCR extractors', required: true },
            { name: 'SUPABASE_SERVICE_ROLE_KEY', desc: 'Supabase → Settings → API (server-only, bypasses RLS)', required: true },
            { name: 'DIGEST_EMAIL', desc: 'Recipient for the weekly digest', required: false },
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
