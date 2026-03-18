import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// Called by Vercel Cron: nightly at 6am UTC
// Also handles Monday digest when day = Monday
export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 1. Run expiration task creation function
  const { data: expirationResult, error: expirationError } = await supabase
    .rpc('create_expiration_tasks')

  if (expirationError) {
    console.error('Expiration tasks error:', expirationError)
  }

  // 2. Unsnoozed tasks - clear snoozed_until if date has passed
  await supabase
    .from('tasks')
    .update({ snoozed_until: null })
    .lte('snoozed_until', new Date().toISOString().slice(0, 10))
    .neq('status', 'done')

  // 3. Monday digest email
  const dayOfWeek = new Date().getDay() // 0=Sun, 1=Mon
  if (dayOfWeek === 1 && process.env.RESEND_API_KEY && process.env.DIGEST_EMAIL) {
    await sendMondayDigest(supabase)
  }

  return NextResponse.json({
    success: true,
    expiration_tasks: expirationResult,
    day: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    timestamp: new Date().toISOString(),
  })
}

async function sendMondayDigest(supabase: any) {
  const today = new Date().toISOString().slice(0, 10)
  const sevenDays = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const ninetyDays = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)

  const [
    { data: overdueTasks },
    { data: dueSoon },
    { data: expiringPolicies },
    { data: openClaims },
    { data: properties },
  ] = await Promise.all([
    supabase.from('tasks').select('title, due_date, priority, property_id, properties(name)').neq('status', 'done').lt('due_date', today).order('due_date'),
    supabase.from('tasks').select('title, due_date, priority, property_id, properties(name)').neq('status', 'done').gte('due_date', today).lte('due_date', sevenDays).order('due_date'),
    supabase.from('insurance_policies').select('carrier, policy_type, expiry_date, property_id, properties(name)').eq('status', 'active').lte('expiry_date', ninetyDays).order('expiry_date'),
    supabase.from('insurance_claims').select('description, status, amount_claimed, properties(name)').neq('status', 'closed').neq('status', 'denied'),
    supabase.from('properties').select('id, name').eq('status', 'active'),
  ])

  const daysUntil = (date: string) => Math.ceil((new Date(date).getTime() - Date.now()) / 86400000)

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #1e293b; }
  h1 { font-size: 20px; font-weight: 600; color: #1e293b; margin-bottom: 4px; }
  .date { font-size: 13px; color: #64748b; margin-bottom: 24px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin: 20px 0 8px; }
  .item { padding: 8px 12px; border-radius: 6px; margin-bottom: 4px; font-size: 13px; }
  .overdue { background: #fef2f2; border-left: 3px solid #ef4444; }
  .soon { background: #fffbeb; border-left: 3px solid #f59e0b; }
  .normal { background: #f8fafc; border-left: 3px solid #e2e8f0; }
  .warn { background: #fefce8; border-left: 3px solid #eab308; }
  .prop { font-size: 11px; color: #94a3b8; margin-top: 2px; }
  .badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 9px; font-weight: 600; text-transform: uppercase; }
  .urgent { background: #fee2e2; color: #b91c1c; }
  .high { background: #ffedd5; color: #c2410c; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; }
</style></head>
<body>
  <h1>C2 Capital — Weekly Digest</h1>
  <div class="date">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>

  ${(overdueTasks ?? []).length > 0 ? `
  <h2>⚠ Overdue Tasks (${(overdueTasks ?? []).length})</h2>
  ${(overdueTasks ?? []).map((t: any) => `
    <div class="item overdue">
      <span class="badge ${t.priority}">${t.priority}</span>
      ${t.title}
      <div class="prop">${(t.properties as any)?.name ?? 'Portfolio'} · Due ${t.due_date}</div>
    </div>`).join('')}
  ` : ''}

  ${(dueSoon ?? []).length > 0 ? `
  <h2>📅 Due This Week (${(dueSoon ?? []).length})</h2>
  ${(dueSoon ?? []).map((t: any) => `
    <div class="item soon">
      <span class="badge ${t.priority}">${t.priority}</span>
      ${t.title}
      <div class="prop">${(t.properties as any)?.name ?? 'Portfolio'} · Due ${t.due_date}</div>
    </div>`).join('')}
  ` : ''}

  ${(expiringPolicies ?? []).length > 0 ? `
  <h2>🛡 Insurance Expiring Within 90 Days (${(expiringPolicies ?? []).length})</h2>
  ${(expiringPolicies ?? []).map((p: any) => {
    const d = daysUntil(p.expiry_date)
    return `<div class="item warn">
      ${p.carrier} — ${p.policy_type.toUpperCase()}
      <div class="prop">${(p.properties as any)?.name ?? 'Portfolio'} · Expires ${p.expiry_date} (${d}d)</div>
    </div>`
  }).join('')}
  ` : ''}

  ${(openClaims ?? []).length > 0 ? `
  <h2>📋 Open Insurance Claims (${(openClaims ?? []).length})</h2>
  ${(openClaims ?? []).map((c: any) => `
    <div class="item normal">
      ${c.description ?? 'No description'} — ${c.status.replace('_',' ')}
      <div class="prop">${(c.properties as any)?.name ?? 'Portfolio'} · Claimed $${(c.amount_claimed ?? 0).toLocaleString()}</div>
    </div>`).join('')}
  ` : ''}

  <div class="footer">
    C2 Capital Portfolio Platform · Generated ${new Date().toISOString()}
  </div>
</body>
</html>`

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'C2 Capital <digest@c2capital.com>',
      to: [process.env.DIGEST_EMAIL!],
      subject: `C2 Capital Weekly Digest — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      html,
    }),
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
  }
}
