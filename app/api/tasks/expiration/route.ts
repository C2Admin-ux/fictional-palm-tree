import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Called by Vercel Cron: every night at 6am UTC
// Configure in vercel.json:
// { "crons": [{ "path": "/api/tasks/expiration", "schedule": "0 6 * * *" }] }

export async function GET(req: NextRequest) {
  // Verify this is called by Vercel Cron (or us)
  const authHeader = req.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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
