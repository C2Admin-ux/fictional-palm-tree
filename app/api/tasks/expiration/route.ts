import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// ────────────────────────────────────────────────────────────
// NIGHTLY TASK CREATION: ON HOLD (2026-07-13, per Nick)
// The nightly cron has been removed from vercel.json, so this route is no
// longer triggered automatically. It remains callable server-to-server with
// Bearer CRON_SECRET. To re-enable the schedule, add back to vercel.json:
//   { "path": "/api/tasks/expiration", "schedule": "0 6 * * *" }   // 6am UTC nightly
// ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or us).
  // Fail closed: if CRON_SECRET is unset, reject rather than run this
  // service-role, data-writing endpoint openly.
  const authHeader = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
