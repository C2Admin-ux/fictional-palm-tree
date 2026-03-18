'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { CapexProject, CapexLineItem, Task } from '@/lib/supabase/types'
import { cn, formatCurrency, formatDate, CAPEX_STATUS_STYLES, STATUS_STYLES, STATUS_LABELS, PRIORITY_DOT } from '@/lib/utils'
import { ArrowLeft, Plus, Trash2, CheckSquare } from 'lucide-react'
import Link from 'next/link'

const STATUSES = ['planning', 'approved', 'in_progress', 'complete', 'on_hold'] as const
const CATEGORIES = ['roof', 'hvac', 'plumbing', 'exterior', 'unit_turn', 'amenity', 'other'] as const

type ProjectWithProp = CapexProject & { properties?: { name: string } | null }

export default function CapexDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = createClient()

  const [project, setProject] = useState<ProjectWithProp | null>(null)
  const [lineItems, setLineItems] = useState<CapexLineItem[]>([])
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [editMode, setEditMode] = useState(false)
  const [form, setForm] = useState<Partial<CapexProject>>({})
  const [addingLine, setAddingLine] = useState(false)
  const [newLine, setNewLine] = useState({ description: '', vendor: '', amount: '', invoice_date: '', invoice_number: '', status: 'pending' })
  const [saving, setSaving] = useState(false)

  async function fetchAll() {
    const [{ data: proj }, { data: lines }, { data: tasks }] = await Promise.all([
      supabase.from('capex_projects').select('*, properties(name)').eq('id', id).single(),
      supabase.from('capex_line_items').select('*').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('capex_project_id', id).neq('status', 'done').order('due_date', { ascending: true, nullsFirst: false }),
    ])
    setProject((proj as unknown) as ProjectWithProp)
    setForm((proj as any) ?? {})
    setLineItems(lines ?? [])
    setLinkedTasks(tasks ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [id])

  async function saveProject() {
    setSaving(true)
    await (supabase.from('capex_projects') as any).update({
      title: form.title, status: form.status, priority: form.priority,
      category: form.category, budget: form.budget, committed: form.committed,
      vendor_name: form.vendor_name, vendor_contact: form.vendor_contact,
      start_date: form.start_date, target_completion: form.target_completion,
      actual_completion: form.actual_completion, notes: form.notes,
    }).eq('id', id)
    setSaving(false)
    setEditMode(false)
    fetchAll()
  }

  async function addLineItem() {
    if (!newLine.description || !newLine.amount) return
    setSaving(true)
    await (supabase.from('capex_line_items') as any).insert({
      project_id: id,
      description: newLine.description,
      vendor: newLine.vendor || null,
      amount: parseFloat(newLine.amount),
      invoice_date: newLine.invoice_date || null,
      invoice_number: newLine.invoice_number || null,
      status: newLine.status,
    })
    setNewLine({ description: '', vendor: '', amount: '', invoice_date: '', invoice_number: '', status: 'pending' })
    setAddingLine(false)
    setSaving(false)
    fetchAll()
  }

  async function toggleLineStatus(line: CapexLineItem) {
    await (supabase.from('capex_line_items') as any)
      .update({ status: line.status === 'paid' ? 'pending' : 'paid' })
      .eq('id', line.id)
    fetchAll()
  }

  async function deleteLineItem(lineId: string) {
    if (!confirm('Delete this line item?')) return
    await supabase.from('capex_line_items').delete().eq('id', lineId)
    fetchAll()
  }

  async function deleteProject() {
    if (!confirm('Delete this project? This cannot be undone.')) return
    await supabase.from('capex_projects').delete().eq('id', id)
    router.push('/capex')
  }

  if (loading) return <div className="p-6 text-sm text-slate-400">Loading…</div>
  if (!project) return <div className="p-6 text-sm text-red-500">Project not found</div>

  const paidTotal = lineItems.filter(l => l.status === 'paid').reduce((s, l) => s + l.amount, 0)
  const pendingTotal = lineItems.filter(l => l.status === 'pending').reduce((s, l) => s + l.amount, 0)
  const budgetVariance = (project.budget ?? 0) - (project.actual_spend ?? 0)
  const over = budgetVariance < 0
  const pct = project.budget && project.budget > 0
    ? Math.min(Math.round((project.actual_spend ?? 0) / project.budget * 100), 100)
    : 0

  const F = (key: keyof CapexProject) => editMode
    ? <input value={(form[key] ?? '') as string} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="input text-sm" />
    : <span className="text-sm text-slate-800">{(project[key] as string) || '—'}</span>

  const FDate = (key: keyof CapexProject) => editMode
    ? <input type="date" value={(form[key] ?? '') as string} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} className="input text-sm" />
    : <span className="text-sm text-slate-800">{formatDate(project[key] as string)}</span>

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      {/* Back + header */}
      <div>
        <Link href="/capex" className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-blue-600 mb-3">
          <ArrowLeft size={12} />Back to CapEx
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              {editMode
                ? <input value={form.title ?? ''} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="input text-xl font-semibold w-auto" />
                : <h1 className="text-xl font-semibold text-slate-900">{project.title}</h1>
              }
              <span className={`badge ${CAPEX_STATUS_STYLES[project.status]}`}>{project.status.replace('_', ' ')}</span>
            </div>
            <p className="text-sm text-slate-400 mt-1">
              {project.properties?.name}
              {project.category && ` · ${project.category.replace('_', ' ')}`}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {editMode ? (
              <>
                <button onClick={() => setEditMode(false)} className="btn-ghost">Cancel</button>
                <button onClick={saveProject} disabled={saving} className="btn-primary">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            ) : (
              <>
                <button onClick={() => setEditMode(true)} className="btn-secondary">Edit</button>
                <button onClick={deleteProject} className="btn-ghost text-red-500 hover:bg-red-50">
                  <Trash2 size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: budget + line items + tasks */}
        <div className="lg:col-span-2 space-y-5">
          {/* Budget */}
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Budget Overview</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              {[
                { label: 'Budget', key: 'budget' as keyof CapexProject, format: formatCurrency },
                { label: 'Committed', key: 'committed' as keyof CapexProject, format: formatCurrency },
                { label: 'Actual Spend', value: project.actual_spend, sub: '(from paid invoices)' },
              ].map(({ label, key, value, format, sub }) => (
                <div key={label}>
                  <div className="text-xs text-slate-400 mb-1">{label}</div>
                  {key && editMode
                    ? <input type="number" value={(form[key] ?? '') as string} onChange={e => setForm(f => ({ ...f, [key!]: parseFloat(e.target.value) || undefined }))} className="input text-sm" />
                    : <div className="text-lg font-semibold text-slate-900">{formatCurrency(key ? project[key] as number : value)}</div>
                  }
                  {sub && <div className="text-xs text-slate-400">{sub}</div>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-slate-100 rounded-full h-2">
                <div className={`h-2 rounded-full ${over ? 'bg-red-400' : 'bg-orange-400'}`} style={{ width: `${pct}%` }} />
              </div>
              <span className={cn('text-sm font-medium', over ? 'text-red-600' : 'text-emerald-600')}>
                {over ? `${formatCurrency(Math.abs(budgetVariance))} over budget` : `${formatCurrency(budgetVariance)} remaining`}
              </span>
            </div>
          </div>

          {/* Line items */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-700">Invoice & Cost Line Items</h2>
              <button onClick={() => setAddingLine(true)} className="btn-secondary text-xs py-1">
                <Plus size={12} />Add line
              </button>
            </div>

            {addingLine && (
              <div className="bg-slate-50 rounded-lg p-3 mb-3 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input placeholder="Description *" value={newLine.description} onChange={e => setNewLine(n => ({ ...n, description: e.target.value }))} className="input-sm" />
                  <input placeholder="Vendor" value={newLine.vendor} onChange={e => setNewLine(n => ({ ...n, vendor: e.target.value }))} className="input-sm" />
                  <input type="number" placeholder="Amount *" value={newLine.amount} onChange={e => setNewLine(n => ({ ...n, amount: e.target.value }))} className="input-sm" />
                  <input type="date" value={newLine.invoice_date} onChange={e => setNewLine(n => ({ ...n, invoice_date: e.target.value }))} className="input-sm" />
                  <input placeholder="Invoice #" value={newLine.invoice_number} onChange={e => setNewLine(n => ({ ...n, invoice_number: e.target.value }))} className="input-sm" />
                  <select value={newLine.status} onChange={e => setNewLine(n => ({ ...n, status: e.target.value }))} className="input-sm">
                    <option value="pending">Pending</option>
                    <option value="paid">Paid</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setAddingLine(false)} className="btn-ghost text-xs py-1">Cancel</button>
                  <button onClick={addLineItem} disabled={saving || !newLine.description || !newLine.amount} className="btn-primary text-xs py-1">Add</button>
                </div>
              </div>
            )}

            {lineItems.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No line items yet</p>
            ) : (
              <>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left pb-2 text-slate-400 font-medium">Description</th>
                      <th className="text-left pb-2 text-slate-400 font-medium hidden sm:table-cell">Date</th>
                      <th className="text-left pb-2 text-slate-400 font-medium">Status</th>
                      <th className="text-right pb-2 text-slate-400 font-medium">Amount</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {lineItems.map(line => (
                      <tr key={line.id} className="group">
                        <td className="py-2">
                          <div className="text-slate-700 font-medium">{line.description}</div>
                          {line.vendor && <div className="text-slate-400">{line.vendor}</div>}
                          {line.invoice_number && <div className="text-slate-400">#{line.invoice_number}</div>}
                        </td>
                        <td className="py-2 text-slate-400 hidden sm:table-cell">{formatDate(line.invoice_date)}</td>
                        <td className="py-2">
                          <button onClick={() => toggleLineStatus(line)}
                            className={cn('px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer', line.status === 'paid' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'bg-slate-50 text-slate-500 hover:bg-slate-100')}>
                            {line.status}
                          </button>
                        </td>
                        <td className="py-2 text-right font-semibold text-slate-900">{formatCurrency(line.amount)}</td>
                        <td className="py-2">
                          <button onClick={() => deleteLineItem(line.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-400 transition-all">
                            <Trash2 size={12} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200">
                      <td colSpan={3} className="pt-2 text-xs text-slate-400">
                        Paid: {formatCurrency(paidTotal)} · Pending: {formatCurrency(pendingTotal)}
                      </td>
                      <td className="pt-2 text-right text-xs font-semibold text-slate-900">
                        {formatCurrency(paidTotal + pendingTotal)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </>
            )}
          </div>

          {/* Linked tasks */}
          {linkedTasks.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <CheckSquare size={14} />Open Linked Tasks ({linkedTasks.length})
                </h2>
                <Link href={`/tasks?capex=${id}`} className="text-xs text-blue-600 hover:underline">View in Tasks →</Link>
              </div>
              <div className="space-y-1.5">
                {linkedTasks.map(task => (
                  <div key={task.id} className="flex items-center gap-2 py-1">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: PRIORITY_DOT[task.priority] ?? '#94a3b8' }} />
                    <span className="text-sm text-slate-700 flex-1 truncate">{task.title}</span>
                    <span className={`badge text-xs ${STATUS_STYLES[task.status]}`}>{STATUS_LABELS[task.status]}</span>
                    {task.due_date && <span className="text-xs text-slate-400">{formatDate(task.due_date)}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: project details */}
        <div className="space-y-5">
          <div className="card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Project Details</h2>
            <div className="space-y-3 text-sm">
              <Field label="Status">
                {editMode
                  ? <select value={form.status ?? ''} onChange={e => setForm(f => ({ ...f, status: e.target.value as any }))} className="input text-sm">
                      {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                  : <span className={`badge ${CAPEX_STATUS_STYLES[project.status]}`}>{project.status.replace('_', ' ')}</span>
                }
              </Field>
              <Field label="Category">
                {editMode
                  ? <select value={form.category ?? ''} onChange={e => setForm(f => ({ ...f, category: e.target.value as any }))} className="input text-sm">
                      <option value="">None</option>
                      {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                    </select>
                  : <span className="text-slate-800 capitalize">{project.category?.replace('_', ' ') ?? '—'}</span>
                }
              </Field>
              <Field label="Vendor">{F('vendor_name')}</Field>
              <Field label="Contact">{F('vendor_contact')}</Field>
              <Field label="Start Date">{FDate('start_date')}</Field>
              <Field label="Target Completion">{FDate('target_completion')}</Field>
              <Field label="Actual Completion">{FDate('actual_completion')}</Field>
            </div>
          </div>

          {(editMode || project.notes) && (
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Notes</h2>
              {editMode
                ? <textarea value={form.notes ?? ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input min-h-[80px] resize-none text-sm w-full" />
                : <p className="text-sm text-slate-600 whitespace-pre-line">{project.notes}</p>
              }
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-400 mb-0.5">{label}</div>
      {children}
    </div>
  )
}
