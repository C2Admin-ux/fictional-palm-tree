'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Document, Property } from '@/lib/supabase/types'
import { cn, formatDate, daysUntil } from '@/lib/utils'
import { Upload, FolderOpen, AlertTriangle, Download, Trash2, X, ChevronDown, FileText, Shield, FileCheck } from 'lucide-react'

const CATEGORIES = ['insurance', 'contract', 'lease', 'report', 'inspection', 'other'] as const

const CATEGORY_ICON: Record<string, React.ReactNode> = {
  insurance:  <Shield size={14} />,
  contract:   <FileCheck size={14} />,
  report:     <FileText size={14} />,
  lease:      <FileText size={14} />,
  inspection: <FileCheck size={14} />,
  other:      <FileText size={14} />,
}

type DocWithProp = Document & { properties?: { name: string } | null }

export default function DocumentsPage() {
  const supabase = createClient()
  const [documents, setDocuments] = useState<DocWithProp[]>([])
  const [properties, setProperties] = useState<Property[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [filterProp, setFilterProp] = useState('')
  const [filterCat, setFilterCat] = useState('')

  const fetchDocs = useCallback(async () => {
    let q = (supabase.from('documents') as any)
      .select('*, properties(name)')
      .order('created_at', { ascending: false })
    if (filterProp === 'portfolio') q = q.is('property_id', null)
    else if (filterProp) q = q.eq('property_id', filterProp)
    if (filterCat) q = q.eq('category', filterCat)
    const { data } = await q
    setDocuments((data as DocWithProp[]) ?? [])
    setLoading(false)
  }, [filterProp, filterCat])

  useEffect(() => { fetchDocs() }, [fetchDocs])
  useEffect(() => {
    supabase.from('properties').select('*').order('name')
      .then(({ data }) => setProperties(data ?? []))
  }, [])

  async function downloadDoc(doc: Document) {
    const { data } = await supabase.storage
      .from('c2-documents')
      .createSignedUrl(doc.file_path, 3600)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
  }

  async function deleteDoc(doc: Document) {
    if (!confirm('Delete this document?')) return
    await supabase.storage.from('c2-documents').remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', doc.id)
    fetchDocs()
  }

  const expiringSoon = documents.filter(d => {
    const days = daysUntil(d.expiration_date)
    return days != null && days <= 60
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Document Vault</h1>
          <p className="text-sm text-slate-500 mt-0.5">{documents.length} documents</p>
        </div>
        <button onClick={() => setShowForm(true)} className="btn-primary">
          <Upload size={14} />Upload Document
        </button>
      </div>

      {/* Expiry alerts */}
      {expiringSoon.length > 0 && (
        <div className="p-4 border border-amber-200 bg-amber-50 rounded-xl">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={14} className="text-amber-600" />
            <span className="text-sm font-semibold text-amber-800">
              {expiringSoon.length} document{expiringSoon.length > 1 ? 's' : ''} expiring within 60 days
            </span>
          </div>
          <div className="space-y-1">
            {expiringSoon.slice(0, 4).map(doc => {
              const days = daysUntil(doc.expiration_date)!
              return (
                <div key={doc.id} className="flex items-center gap-2 text-xs text-amber-700">
                  <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                    days <= 30 ? 'bg-red-500' : 'bg-amber-400')} />
                  <span className="font-medium truncate">{doc.title}</span>
                  <span className="text-amber-500">·</span>
                  <span>{doc.properties?.name ?? 'Portfolio'}</span>
                  <span className="ml-auto font-medium">{days <= 0 ? 'EXPIRED' : `${days}d left`}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Sel value={filterProp} onChange={setFilterProp}>
          <option value="">All properties</option>
          <option value="portfolio">Portfolio-wide</option>
          {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Sel>
        <Sel value={filterCat} onChange={setFilterCat}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </Sel>
        {(filterProp || filterCat) && (
          <button onClick={() => { setFilterProp(''); setFilterCat('') }}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1">
            <X size={11} />Reset
          </button>
        )}
      </div>

      {/* Documents grid */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : documents.length === 0 ? (
        <div className="py-16 text-center card">
          <FolderOpen size={36} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">No documents yet</p>
          <button onClick={() => setShowForm(true)} className="mt-3 text-sm text-blue-600 hover:underline">
            Upload your first document
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {documents.map(doc => {
            const days = daysUntil(doc.expiration_date)
            const expiring = days != null && days <= 60
            const expired = days != null && days <= 0
            return (
              <div key={doc.id}
                className={cn('bg-white rounded-xl border p-4 group hover:shadow-md transition-shadow',
                  expired ? 'border-red-200' : expiring ? 'border-amber-200' : 'border-slate-200')}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">{CATEGORY_ICON[doc.category]}</span>
                    <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                      {doc.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => downloadDoc(doc)} className="text-slate-300 hover:text-blue-500 p-1" title="Download">
                      <Download size={13} />
                    </button>
                    <button onClick={() => deleteDoc(doc)} className="text-slate-300 hover:text-red-400 p-1" title="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="font-medium text-slate-900 text-sm leading-snug mb-1 line-clamp-2">
                  {doc.title}
                </div>
                <div className="text-xs text-slate-400">{doc.properties?.name ?? 'Portfolio-wide'}</div>
                {doc.expiration_date && (
                  <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium',
                    expired ? 'text-red-600' : expiring ? 'text-amber-600' : 'text-slate-400')}>
                    {expiring && <AlertTriangle size={11} />}
                    {expired ? 'EXPIRED' : `Expires ${formatDate(doc.expiration_date)}`}
                  </div>
                )}
                {doc.file_name && (
                  <div className="text-xs text-slate-300 mt-0.5 truncate">{doc.file_name}</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <UploadModal
          properties={properties}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); fetchDocs() }}
        />
      )}
    </div>
  )
}

function UploadModal({ properties, onClose, onSave }: {
  properties: Property[]; onClose: () => void; onSave: () => void
}) {
  const supabase = createClient()
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({
    title: '', property_id: '', category: 'other',
    expiration_date: '', notice_days: '60', tags: '',
  })
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  function handleFile(f: File) {
    setFile(f)
    if (!form.title) setForm(prev => ({ ...prev, title: f.name.replace(/\.[^.]+$/, '') }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    const propertyPath = form.property_id || 'portfolio'
    const path = `${propertyPath}/${form.category}/${Date.now()}-${file.name}`
    const { error } = await supabase.storage.from('c2-documents').upload(path, file)
    if (error) { alert('Upload failed: ' + error.message); setUploading(false); return }
    await (supabase.from('documents') as any).insert({
      title:           form.title,
      property_id:     form.property_id || null,
      category:        form.category,
      file_path:       path,
      file_name:       file.name,
      file_size_bytes: file.size,
      mime_type:       file.type,
      expiration_date: form.expiration_date || null,
      notice_days:     parseInt(form.notice_days) || 60,
      tags:            form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
    })
    setUploading(false)
    onSave()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Upload Document</h2>
          <button onClick={onClose}><X size={18} className="text-slate-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
            onClick={() => document.getElementById('file-input')?.click()}
            className={cn('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
              dragOver ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300 bg-slate-50')}>
            {file ? (
              <div className="text-sm text-slate-700">
                <div className="font-medium">{file.name}</div>
                <div className="text-slate-400 text-xs mt-0.5">{(file.size / 1024).toFixed(1)} KB</div>
              </div>
            ) : (
              <>
                <Upload size={24} className="text-slate-300 mx-auto mb-2" />
                <div className="text-sm text-slate-500">Drop file here or click to browse</div>
                <div className="text-xs text-slate-400 mt-0.5">PDF, JPG, PNG, XLSX, DOCX</div>
              </>
            )}
            <input id="file-input" type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          </div>

          <div>
            <label className="label">Title *</label>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              className="input" placeholder="Document title" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Property</label>
              <select value={form.property_id} onChange={e => setForm(f => ({ ...f, property_id: e.target.value }))} className="input">
                <option value="">Portfolio-wide</option>
                {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Category</label>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="input">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Expiration Date</label>
              <input type="date" value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} className="input" />
            </div>
            <div>
              <label className="label">Notice (days before)</label>
              <select value={form.notice_days} onChange={e => setForm(f => ({ ...f, notice_days: e.target.value }))} className="input">
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" disabled={uploading || !file} className="btn-primary">
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none bg-white border border-slate-200 rounded-lg pl-3 pr-7 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer">
        {children}
      </select>
      <ChevronDown size={12} className="absolute right-2 top-2.5 text-slate-400 pointer-events-none" />
    </div>
  )
}
