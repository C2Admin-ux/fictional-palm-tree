import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isCronRequest, unauthorized } from '@/lib/api-auth'

// ────────────────────────────────────────────────────────────
// NIGHTLY TASK CREATION: ON HOLD (2026-07-13, per Nick)
// The nightly cron has been removed from vercel.json, so this route is no
// longer triggered automatically. It remains callable server-to-server with
// Bearer CRON_SECRET. To re-enable the schedule, add back to vercel.json:
//   { "path": "/api/tasks/expiration", "schedule": "0 6 * * *" }   // 6am UTC nightly
//
// NOTE for re-enable: the deleted cron/nightly route also used to clear
// expired task snoozes (update tasks set snoozed_until=null where
// snoozed_until <= today). Nothing does that today — harmless while no view
// filters on snoozed_until, but if snooze-hiding is ever built, recreate
// that step here.
// ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Vercel Cron / server-to-server only; fail closed (see lib/api-auth.ts).
  if (!isCronRequest(req)) return unauthorized()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    // Call the database function that creates expiration tasks
    const { data, error } = await supabase.rpc('create_expiration_tasks')
    if (error) throw error

    return NextResponse.json({
      success: true,
      result: data,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('Expiration task creation failed:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
