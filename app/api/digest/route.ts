import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

// ── Config ───────────────────────────────────────────────────
const RECIPIENT = 'nick@c2cpllc.com'
const DIGEST_FROM = 'C2 Capital Digest <digest@c2capital.co>'

// Vercel cron: every Sunday at 6pm MT = Monday 1am UTC
// vercel.json: { "path": "/api/digest", "schedule": "0 1 * * 1" }

export async function GET(req: NextRequest) {
  // Auth check
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
  const resend = new Resend(process.env.RESEND_API_KEY!)

  try {
    // ── 1. Pull platform data ──────────────────────────────
    const [
      { data: tasks },
      { data: policies },
      { data: contracts },
      { data: claims },
      { data: properties },
    ] = await Promise.all([
      supabase.from('tasks')
        .select('*, properties(name)')
        .in('status', ['inbox', 'next_action', 'waiting', 'blocked'])
        .in('priority', ['urgent', 'high'])
        .order('priority', { ascending: true })
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(20),
      supabase.from('insurance_policies')
        .select('*, properties(name)')
        .eq('status', 'active')
        .lte('expiry_date', new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .order('expiry_date', { ascending: true }),
      (supabase.from('contracts') as any)
        .select('*, properties(name)')
        .eq('status', 'active')
        .or(`expiration_date.lte.${new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)},cancel_deadline.lte.${new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}`)
        .order('cancel_deadline', { ascending: true, nullsFirst: false }),
      supabase.from('insurance_claims')
        .select('*, properties(name)')
        .not('status', 'in', '("closed","denied")')
        .lte('follow_up_date', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        .order('follow_up_date', { ascending: true }),
      supabase.from('properties').select('id, name').eq('status', 'active').order('name'),
    ])

    const propNames = (properties ?? []).map((p: any) => p.name)

    // ── 2. Scan Gmail via Claude API ───────────────────────
    let gmailItems: GmailItem[] = []
    try {
      gmailItems = await scanGmailForFollowUps(propNames)
    } catch (err) {
      console.error('Gmail scan failed:', err)
      // Non-fatal — digest sends without Gmail section
    }

    // ── 3. Build and send email ────────────────────────────
    const html = buildEmailHtml({
      tasks: tasks ?? [],
      policies: policies ?? [],
      contracts: contracts ?? [],
      claims: claims ?? [],
      gmailItems,
    })

    const { error } = await resend.emails.send({
      from: DIGEST_FROM,
      to: RECIPIENT,
      subject: `C2 Capital Weekly Digest — ${formatDigestDate()}`,
      html,
    })

    if (error) throw new Error(`Resend error: ${error.message}`)

    return NextResponse.json({
      success: true,
      sent_to: RECIPIENT,
      sections: {
        tasks: (tasks ?? []).length,
        policies_expiring: (policies ?? []).length,
        contracts_expiring: (contracts ?? []).length,
        claims_due: (claims ?? []).length,
        gmail_items: gmailItems.length,
      },
    })

  } catch (err: any) {
    console.error('Digest failed:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Gmail Scanner ────────────────────────────────────────────

type GmailItem = {
  subject: string
  from: string
  date: string
  snippet: string
  reason: 'snoozed_due' | 'awaiting_reply'
  thread_id: string
  urgency: 'high' | 'medium' | 'low'
}

async function scanGmailForFollowUps(propertyNames: string[]): Promise<GmailItem[]> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const sevenDaysAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  // Call Claude API with Gmail MCP to scan inbox
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: `You are an assistant helping a multifamily real estate asset manager scan his Gmail inbox.
Your job is to find emails that need a follow-up response.

Property names in his portfolio: ${propertyNames.join(', ')}
Key contacts: Todd Mikelonis (AMC/Fox Hill), Jenny Roach (GBC/Pikes Place), Amanda Grubham (BRC/Cottages on Vance), Kelli Anderson (Four Star/Main Street), Chris Arnold (insurance broker), Cory (partner at C2 Capital).

Find two types of emails:
1. SNOOZED: Emails with Gmail snooze labels that are coming due within the next 7 days (before ${sevenDaysAhead.toDateString()})
2. AWAITING_REPLY: Emails received in the last 7 days (after ${sevenDaysAgo.toDateString()}) where:
   - The sender is a vendor, PM, or business contact (not marketing/newsletters/automated)
   - The email's language implies a response is expected (questions asked, action requested, "please let me know", "can you confirm", etc.)
   - Nick has NOT replied to the thread

For each item found, return JSON only — no other text:
{
  "items": [
    {
      "subject": "email subject",
      "from": "sender name and email",
      "date": "YYYY-MM-DD",
      "snippet": "first 100 chars of email body",
      "reason": "snoozed_due" | "awaiting_reply",
      "thread_id": "gmail thread id",
      "urgency": "high" | "medium" | "low",
      "why": "one sentence explaining why this needs follow-up"
    }
  ]
}

Return ONLY valid JSON. No preamble, no explanation outside the JSON.`,
      messages: [{ role: 'user', content: 'Please scan my Gmail inbox now and return the JSON of items needing follow-up.' }],
      mcp_servers: [
        {
          type: 'url',
          url: 'https://gmail.mcp.claude.com/mcp',
          name: 'gmail',
        }
      ],
    }),
  })

  const data = await response.json()

  // Extract JSON from response
  const textBlocks = (data.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('')

  // Parse the JSON response
  const jsonMatch = textBlocks.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  const parsed = JSON.parse(jsonMatch[0])
  return parsed.items ?? []
}

// ── Email HTML Builder ───────────────────────────────────────

function buildEmailHtml({ tasks, policies, contracts, claims, gmailItems }: {
  tasks: any[]
  policies: any[]
  contracts: any[]
  claims: any[]
  gmailItems: GmailItem[]
}) {
  const hasContent = tasks.length || policies.length || contracts.length || claims.length || gmailItems.length

  const urgentTasks = tasks.filter(t => t.priority === 'urgent')
  const highTasks = tasks.filter(t => t.priority === 'high')

  const highGmail = gmailItems.filter(i => i.urgency === 'high')
  const medGmail = gmailItems.filter(i => i.urgency !== 'high')

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>C2 Capital Weekly Digest</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; margin: 0; padding: 0; }
  .wrapper { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 16px; overflow: hidden; }
  .card-header { padding: 14px 20px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; gap: 8px; }
  .card-header h2 { font-size: 13px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .badge-red { background: #fef2f2; color: #dc2626; }
  .badge-amber { background: #fffbeb; color: #d97706; }
  .badge-blue { background: #eff6ff; color: #2563eb; }
  .badge-slate { background: #f8fafc; color: #64748b; }
  .item { padding: 12px 20px; border-bottom: 1px solid #f8fafc; }
  .item:last-child { border-bottom: none; }
  .item-title { font-size: 13px; font-weight: 500; color: #1e293b; margin-bottom: 3px; }
  .item-meta { font-size: 11px; color: #94a3b8; }
  .item-meta strong { color: #64748b; }
  .pip { display: inline-block; width: 6px; height: 6px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
  .pip-red { background: #ef4444; }
  .pip-amber { background: #f59e0b; }
  .pip-blue { background: #3b82f6; }
  .empty { padding: 16px 20px; font-size: 13px; color: #94a3b8; font-style: italic; }
  .header { text-align: center; padding: 24px 0 16px; }
  .header h1 { font-size: 20px; font-weight: 700; color: #1e293b; margin: 0 0 4px; }
  .header p { font-size: 13px; color: #64748b; margin: 0; }
  .footer { text-align: center; padding: 20px 0; font-size: 11px; color: #94a3b8; }
  .footer a { color: #3b82f6; text-decoration: none; }
  .section-empty { color: #94a3b8; font-size: 12px; font-style: italic; padding: 12px 20px; }
  .gmail-why { font-size: 11px; color: #64748b; margin-top: 2px; font-style: italic; }
  .all-clear { text-align: center; padding: 32px 20px; color: #64748b; font-size: 14px; }
</style>
</head>
<body>
<div class="wrapper">

  <!-- Header -->
  <div class="header">
    <h1>C2 Capital Weekly Digest</h1>
    <p>${formatDigestDate()} · Good evening, Nick</p>
  </div>

  ${!hasContent ? `
  <div class="card">
    <div class="all-clear">✅ No outstanding items this week — clean slate!</div>
  </div>
  ` : ''}

  <!-- Gmail: High urgency -->
  ${highGmail.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>📬 Gmail — Needs Reply Soon</h2>
      <span class="badge badge-red">${highGmail.length}</span>
    </div>
    ${highGmail.map(item => `
    <div class="item">
      <div class="item-title"><span class="pip pip-red"></span>${escHtml(item.subject)}</div>
      <div class="item-meta">
        <strong>${escHtml(item.from)}</strong> &nbsp;·&nbsp; ${escHtml(item.date)}
        &nbsp;·&nbsp; <span class="badge badge-red">${item.reason === 'snoozed_due' ? 'Snoozed due' : 'Awaiting reply'}</span>
      </div>
      ${(item as any).why ? `<div class="gmail-why">${escHtml((item as any).why)}</div>` : ''}
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Gmail: Medium/Low -->
  ${medGmail.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>📬 Gmail — Follow Up This Week</h2>
      <span class="badge badge-amber">${medGmail.length}</span>
    </div>
    ${medGmail.map(item => `
    <div class="item">
      <div class="item-title"><span class="pip pip-amber"></span>${escHtml(item.subject)}</div>
      <div class="item-meta">
        <strong>${escHtml(item.from)}</strong> &nbsp;·&nbsp; ${escHtml(item.date)}
        &nbsp;·&nbsp; <span class="badge badge-amber">${item.reason === 'snoozed_due' ? 'Snoozed due' : 'Awaiting reply'}</span>
      </div>
      ${(item as any).why ? `<div class="gmail-why">${escHtml((item as any).why)}</div>` : ''}
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Urgent Tasks -->
  ${urgentTasks.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>🔴 Urgent Tasks</h2>
      <span class="badge badge-red">${urgentTasks.length}</span>
    </div>
    ${urgentTasks.map(t => `
    <div class="item">
      <div class="item-title">${escHtml(t.title)}</div>
      <div class="item-meta">
        <strong>${(t.properties?.name ?? 'Portfolio')}</strong>
        ${t.due_date ? ` &nbsp;·&nbsp; Due ${formatShortDate(t.due_date)}` : ''}
        &nbsp;·&nbsp; ${t.status.replace('_', ' ')}
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- High Tasks -->
  ${highTasks.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>🟠 High Priority Tasks</h2>
      <span class="badge badge-amber">${highTasks.length}</span>
    </div>
    ${highTasks.map(t => `
    <div class="item">
      <div class="item-title">${escHtml(t.title)}</div>
      <div class="item-meta">
        <strong>${(t.properties?.name ?? 'Portfolio')}</strong>
        ${t.due_date ? ` &nbsp;·&nbsp; Due ${formatShortDate(t.due_date)}` : ''}
        &nbsp;·&nbsp; ${t.status.replace('_', ' ')}
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Expiring Insurance -->
  ${policies.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>🛡 Insurance Expiring ≤ 60 Days</h2>
      <span class="badge ${policies.some(p => daysLeft(p.expiry_date) <= 0) ? 'badge-red' : 'badge-amber'}">${policies.length}</span>
    </div>
    ${policies.map(p => {
      const d = daysLeft(p.expiry_date)
      return `
    <div class="item">
      <div class="item-title"><span class="pip ${d <= 0 ? 'pip-red' : d <= 30 ? 'pip-red' : 'pip-amber'}"></span>${escHtml(p.carrier)} — ${p.policy_type.toUpperCase()}</div>
      <div class="item-meta">
        <strong>${(p.properties?.name ?? 'Portfolio')}</strong>
        &nbsp;·&nbsp; ${p.policy_number ?? ''}
        &nbsp;·&nbsp; Expires ${formatShortDate(p.expiry_date)}
        &nbsp;·&nbsp; <span class="badge ${d <= 0 ? 'badge-red' : 'badge-amber'}">${d <= 0 ? 'EXPIRED' : `${d}d left`}</span>
      </div>
    </div>
    `}).join('')}
  </div>
  ` : ''}

  <!-- Expiring Contracts -->
  ${contracts.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>📄 Contract Deadlines ≤ 60 Days</h2>
      <span class="badge badge-amber">${contracts.length}</span>
    </div>
    ${contracts.map((c: any) => {
      const cancelD = c.cancel_deadline ? daysLeft(c.cancel_deadline) : null
      const expD = c.expiration_date ? daysLeft(c.expiration_date) : null
      const mostUrgent = cancelD != null && (expD == null || cancelD < expD) ? cancelD : expD
      const isCancel = cancelD != null && (expD == null || cancelD < expD)
      return `
    <div class="item">
      <div class="item-title"><span class="pip ${(mostUrgent ?? 999) <= 30 ? 'pip-red' : 'pip-amber'}"></span>${escHtml(c.vendor_name)} — ${escHtml(c.title)}</div>
      <div class="item-meta">
        <strong>${(c.properties?.name ?? 'Portfolio')}</strong>
        &nbsp;·&nbsp; ${isCancel ? `Cancel deadline ${formatShortDate(c.cancel_deadline)}` : `Expires ${formatShortDate(c.expiration_date)}`}
        ${c.cancel_method ? ` &nbsp;·&nbsp; ${c.cancel_method.replace('_', ' ')} required` : ''}
        &nbsp;·&nbsp; <span class="badge badge-amber">${(mostUrgent ?? 0) <= 0 ? 'TODAY' : `${mostUrgent}d`}</span>
      </div>
    </div>
    `}).join('')}
  </div>
  ` : ''}

  <!-- Claims due for follow-up -->
  ${claims.length > 0 ? `
  <div class="card">
    <div class="card-header">
      <h2>⚖️ Claims — Follow-up Due This Week</h2>
      <span class="badge badge-blue">${claims.length}</span>
    </div>
    ${claims.map((c: any) => `
    <div class="item">
      <div class="item-title"><span class="pip pip-blue"></span>${escHtml(c.description ?? c.claim_id ?? 'Claim')}</div>
      <div class="item-meta">
        <strong>${(c.properties?.name ?? 'Portfolio')}</strong>
        &nbsp;·&nbsp; ${c.status.replace('_', ' ')}
        &nbsp;·&nbsp; Follow-up ${formatShortDate(c.follow_up_date)}
        ${c.next_action ? ` &nbsp;·&nbsp; ${escHtml(c.next_action)}` : ''}
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <!-- Footer -->
  <div class="footer">
    C2 Capital Portfolio Platform &nbsp;·&nbsp;
    <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://fictional-palm-tree.vercel.app'}/dashboard">Open Dashboard</a>
    &nbsp;·&nbsp; <a href="${process.env.NEXT_PUBLIC_APP_URL ?? 'https://fictional-palm-tree.vercel.app'}/tasks">View All Tasks</a>
  </div>

</div>
</body>
</html>`
}

// ── Helpers ──────────────────────────────────────────────────

function formatDigestDate() {
  return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatShortDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function daysLeft(dateStr: string | null): number {
  if (!dateStr) return 999
  return Math.floor((new Date(dateStr + 'T00:00:00').getTime() - Date.now()) / (1000 * 60 * 60 * 24))
}

function escHtml(str: string | null | undefined): string {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
