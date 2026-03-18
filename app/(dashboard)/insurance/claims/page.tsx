'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { InsuranceClaim, Property } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { Plus, X, AlertTriangle } from 'lucide-react'

const STATUSES = ['reported','under_review','negotiating','settlement','closed','denied'] as const
const STATUS_LABELS: Record<string,string> = { reported:'Reported', under_review:'Under Review', negotiating:'Negotiating', settlement:'Settlement', closed:'Closed', denied:'Denied' }
const STATUS_STYLES: Record<string,string> = { reported:'text-blue-700 bg-blue-50 border-blue-200', under_review:'text-amber-700 bg-amber-50 border-amber-200', negotiating:'text-purple-700 bg-purple-50 border-purple-200', settlement:'text-emerald-700 bg-emerald-50 border-emerald-200', closed:'text-slate-500 bg-slate-50 border-slate-200', denied:'text-red-700 bg-red-50 border-red-200' }
const STAGE_PROGRESS: Record<string,number> = { reported:10, under_review:35, negotiating:60, settlement:85, closed:100, denied:100 }
const CLAIM_TYPES = ['property_damage','liability','loss_of_income','other'] as const
const TYPE_LABELS: Record<string,string> = { property_damage:'Property Damage', liability:'Liability', loss_of_income:'Loss of Income', other:'Other' }

type ClaimWithProp = InsuranceClaim & { properties?: { name: string } | null }

export default function InsuranceClaimsPage() {
  const supabase = createClient()
  const [claims, setClaims] = useState<ClaimWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editClaim, setEditClaim] = useState<ClaimWithProp | null>(null)
  const [activeTab, setActiveTab] = useState<'open'|'all'|'closed'>('open')
  const [filterProp, setFilterProp] = useState('')

  const fetchClaims = useCallback(async () => {
    let q = (supabase.from('insurance_claims') as any).select('*, properties(name)').order('date_reported', { ascending: false })
    if (filterProp) q = q.eq('property_id', filterProp)
    const { data } = await q
    setClaims((data as ClaimWithProp[]) ?? [])
    setLoading(false)
  }, [filterProp])

  useEffect(() => { fetchClaims() }, [fetchClaims])
  useEffect(() => { supabase.from('properties').select('*').order('name').then(({ data }) => setProperties(data ?? [])) }, [])

  const filtered = claims.filter(c => {
    const isOpen = c.status !== 'closed' && c.status !== 'denied'
    if (activeTab === 'open') return isOpen
    if (activeTab === 'closed') return !isOpen
    return true
  })

  const openClaims = claims.filter(c => c.status !== 'closed' && c.status !== 'denied')
  const totalClaimed = openClaims.reduce((s, c) => s + (c.amount_claimed ?? 0), 0)
  const totalApproved = openClaims.reduce((s, c) => s + (c.amount_approved ?? 0), 0)
  const totalOutstanding = openClaims.reduce((s, c) => s + ((c.amount_approved ?? 0) - (c.amount_paid ?? 0)), 0)
  const daysOpen = (c: ClaimWithProp) => !c.date_reported ? null : Math.floor((Date.now() - new Date(c.date_reported).getTime()) / 86400000)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Insurance Claims</h1>
          <p className="text-sm text-slate-500 mt-0.5">{openClaims.length} open claims</p>
        </div>
        <button onClick={() => { setEditClaim(null); setShowForm(true) }} className="btn-primary"><Plus size={14} />New Claim</button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {([['Open Claims',String(openClaims.length),''],['Total Claimed',formatCurrency(totalClaimed,true),'Open'],['Approved',formatCurrency(totalApproved,true),''],['Outstanding',formatCurrency(totalOutstanding,true),'Unpaid']]) .map(([l,v,s]) => (
          <div key={l} className="card p-4"><div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">{l}</div><div className="text-xl font-semibold text-slate-900">{v}</div>{s ? <div className="text-xs text-slate-400 mt-0.5">{s}</div> : null}</div>
        ))}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex border-b border-slate-200">
          {(['open','all','closed'] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize', activeTab===t?'border-blue-600 text-blue-600':'border-transparent text-slate-500 hover:text-slate-700')}>
              {t} ({t==='open'?openClaims.length:t==='closed'?claims.filter(c=>c.status==='closed'||c.status==='denied').length:claims.length})
            </button>
          ))}
        </div>
        <select value={filterProp} onChange={e => setFilterProp(e.target.value)} className="input-sm w-auto">
          <option value="">All properties</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
        : filtered.length === 0 ? <div className="py-12 text-center card text-sm text-slate-400 p-8">No claims in this view</div>
        : (
          <div className="space-y-4">
            {filtered.map(claim => {
              const days = daysOpen(claim)
              const outstanding = (claim.amount_approved ?? 0) - (claim.amount_paid ?? 0)
              const pct = STAGE_PROGRESS[claim.status] ?? 0
              const overdue = claim.follow_up_date && new Date(claim.follow_up_date) < new Date()
              return (
                <div key={claim.id} className="card overflow-hidden hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-xs font-mono text-slate-400">{claim.claim_id ?? 'CLM-'+claim.id.slice(0,6)}</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-500">{TYPE_LABELS[claim.claim_type]??claim.claim_type}</span>
                        {claim.unit_number && <><span className="text-xs text-slate-400">·</span><span className="text-xs text-slate-500">Unit {claim.unit_number}</span></>}
                      </div>
                      <div className="font-semibold text-slate-900 text-sm">{claim.description||'No description'}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{claim.properties?.name??'Portfolio'}</div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={cn('badge text-xs', STATUS_STYLES[claim.status]??'')}>{STATUS_LABELS[claim.status]}</span>
                      {days!=null&&<span className={cn('text-xs font-medium',days>60?'text-red-500':'text-slate-400')}>{days}d open</span>}
                      <button onClick={()=>{setEditClaim(claim);setShowForm(true)}} className="text-xs text-slate-400 hover:text-blue-600">Edit</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-0 divide-x divide-slate-100">
                    <div className="p-3 space-y-1.5 text-xs">
                      {[['Date of Loss',formatDate(claim.date_of_loss)],['Reported',formatDate(claim.date_reported)],['Adjuster',claim.adjuster_name??'—'],claim.adjuster_phone&&['Phone',claim.adjuster_phone]].filter(Boolean).map((row) => {
                        const [l,v] = row as string[]
                        return <div key={l} className="flex justify-between"><span className="text-slate-400">{l}</span><span className="text-slate-700 font-medium truncate ml-2 max-w-[100px]">{v}</span></div>
                      })}
                    </div>
                    <div className="p-3 space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-slate-400">Estimated</span><span className="font-semibold text-slate-900">{formatCurrency(claim.amount_claimed)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Approved</span><span className={cn('font-semibold',claim.amount_approved?'text-emerald-700':'text-slate-400')}>{claim.amount_approved!=null?formatCurrency(claim.amount_approved):'Pending'}</span></div>
                      <div className="flex justify-between"><span className="text-slate-400">Paid</span><span className="text-slate-700 font-medium">{formatCurrency(claim.amount_paid)}</span></div>
                      {outstanding>0&&<div className="flex justify-between"><span className="text-slate-400">Outstanding</span><span className="text-amber-700 font-semibold">{formatCurrency(outstanding)}</span></div>}
                    </div>
                    <div className="p-3 text-xs">{claim.notes&&<p className="text-slate-500 line-clamp-3">{claim.notes}</p>}</div>
                  </div>
                  <div className="px-4 py-2 border-t border-slate-100 flex items-center gap-3">
                    <div className="flex-1 bg-slate-100 rounded-full h-1.5"><div className={cn('h-1.5 rounded-full',claim.status==='denied'?'bg-red-400':'bg-blue-500')} style={{width:`${pct}%`}}/></div>
                    <span className="text-xs text-slate-400">{pct}%</span>
                  </div>
                  {claim.next_action&&(
                    <div className={cn('flex items-center gap-2 px-4 py-2 text-xs',overdue?'bg-red-50 border-t border-red-100':'bg-amber-50 border-t border-amber-100')}>
                      {overdue&&<AlertTriangle size={11} className="text-red-500 flex-shrink-0"/>}
                      <span className={cn('font-medium uppercase tracking-wide text-xs',overdue?'text-red-700':'text-amber-700')}>Next action</span>
                      <span className={cn('flex-1',overdue?'text-red-600':'text-amber-700')}>{claim.next_action}</span>
                      {claim.follow_up_date&&<span className={cn('font-medium flex-shrink-0',overdue?'text-red-700':'text-amber-700')}>Due {formatDate(claim.follow_up_date)}</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      }
      {showForm&&<ClaimForm claim={editClaim} properties={properties} onClose={()=>{setShowForm(false);setEditClaim(null)}} onSave={()=>{setShowForm(false);setEditClaim(null);fetchClaims()}}/>}
    </div>
  )
}

function ClaimForm({claim,properties,onClose,onSave}:{claim:ClaimWithProp|null;properties:Property[];onClose:()=>void;onSave:()=>void}) {
  const supabase = createClient()
  const [form,setForm] = useState({property_id:claim?.property_id??'',claim_type:claim?.claim_type??'property_damage',status:claim?.status??'reported',priority:claim?.priority??'high',unit_number:claim?.unit_number??'',description:claim?.description??'',date_of_loss:claim?.date_of_loss??'',date_reported:claim?.date_reported??new Date().toISOString().slice(0,10),amount_claimed:claim?.amount_claimed?.toString()??'',amount_approved:claim?.amount_approved?.toString()??'',amount_paid:claim?.amount_paid?.toString()??'',adjuster_name:claim?.adjuster_name??'',adjuster_phone:claim?.adjuster_phone??'',adjuster_email:claim?.adjuster_email??'',next_action:claim?.next_action??'',follow_up_date:claim?.follow_up_date??'',notes:claim?.notes??''})
  const [saving,setSaving]=useState(false)
  async function handleSubmit(e:React.FormEvent){
    e.preventDefault();setSaving(true)
    const n=(v:string)=>v!==''?parseFloat(v):null
    const payload={property_id:form.property_id||null,claim_type:form.claim_type,status:form.status,priority:form.priority,unit_number:form.unit_number||null,description:form.description||null,date_of_loss:form.date_of_loss||null,date_reported:form.date_reported||null,amount_claimed:n(form.amount_claimed),amount_approved:n(form.amount_approved),amount_paid:n(form.amount_paid),adjuster_name:form.adjuster_name||null,adjuster_phone:form.adjuster_phone||null,adjuster_email:form.adjuster_email||null,next_action:form.next_action||null,follow_up_date:form.follow_up_date||null,notes:form.notes||null}
    if(claim){await (supabase.from('insurance_claims') as any).update(payload).eq('id',claim.id)}
    else{await (supabase.from('insurance_claims') as any).insert(payload)}
    setSaving(false);onSave()
  }
  const F=(key:string,label:string,type='text')=>(<div><label className="label">{label}</label><input type={type} value={(form as any)[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} className="input"/></div>)
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-white">
          <h2 className="font-semibold">{claim?'Edit Claim':'New Insurance Claim'}</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400"/></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Property</label><select value={form.property_id} onChange={e=>setForm(f=>({...f,property_id:e.target.value}))} className="input"><option value="">Select…</option>{properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label className="label">Claim Type *</label><select required value={form.claim_type} onChange={e=>setForm(f=>({...f,claim_type:e.target.value}))} className="input">{CLAIM_TYPES.map(t=><option key={t} value={t}>{TYPE_LABELS[t]}</option>)}</select></div>
            <div><label className="label">Status</label><select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className="input">{STATUSES.map(s=><option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select></div>
            <div><label className="label">Priority</label><select value={form.priority} onChange={e=>setForm(f=>({...f,priority:e.target.value}))} className="input"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-3">{F('description','Description of Loss')}{F('unit_number','Unit Number')}</div>
          <div className="grid grid-cols-2 gap-3">{F('date_of_loss','Date of Loss','date')}{F('date_reported','Date Reported','date')}</div>
          <div className="grid grid-cols-3 gap-3">{F('amount_claimed','Estimated ($)','number')}{F('amount_approved','Approved ($)','number')}{F('amount_paid','Paid ($)','number')}</div>
          <div className="grid grid-cols-2 gap-3">{F('adjuster_name','Adjuster Name')}{F('adjuster_phone','Adjuster Phone')}</div>
          <div className="grid grid-cols-2 gap-3">{F('next_action','Next Action')}{F('follow_up_date','Follow-up Date','date')}</div>
          {F('notes','Notes')}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving?'Saving…':claim?'Save':'Create claim'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
