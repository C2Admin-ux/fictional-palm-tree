import { NextRequest, NextResponse } from 'next/server'
import { isValidCronToken, unauthorized } from '@/lib/api-auth'
import { serviceRoleClient } from '@/lib/calls/ingest'

// Callback from the Gmail Apps Script after it created the recap draft:
// records the draft so the call page can link straight to it.
// POST { token, draft_id, message_id } → { success: true }

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params
  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }
  if (!isValidCronToken(body?.token)) return unauthorized()
  const draftId = typeof body.draft_id === 'string' ? body.draft_id : null
  const messageId = typeof body.message_id === 'string' ? body.message_id : null
  if (!draftId) return NextResponse.json({ error: 'draft_id is required' }, { status: 400 })

  const { error } = await serviceRoleClient().from('calls').update({
    recap_status: 'drafted',
    recap_draft_id: draftId,
    recap_draft_url: messageId ? `https://mail.google.com/mail/u/0/#drafts?compose=${messageId}` : 'https://mail.google.com/mail/u/0/#drafts',
    updated_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
