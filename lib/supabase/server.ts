import { createServerClient } from '@supabase/ssr'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import type { Database } from './types'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

// Service-role client for storage/DB operations that must bypass RLS.
//
// Deliberately NOT createServerClient-with-cookies: wiring the request's
// session cookies into a client built on the service key makes supabase-js
// load the USER's session and send the user's JWT as the Authorization
// header — the service key is demoted to a mere apikey and every call
// silently runs as role `authenticated` with RLS applied. This is exactly
// the environment-dependent failure mode that only shows up on deployed
// session-authenticated requests (locally/cron there are no session
// cookies, so the same code behaves as real service-role). A bare client
// with sessions disabled always authenticates as service_role.
//
// Kept async so call sites (`await createAdminClient()`) are unchanged.
export async function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    // Fail with a nameable cause instead of an opaque crash inside
    // supabase-js — surfaces in route error envelopes and function logs.
    throw new Error('createAdminClient: SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not set in this environment')
  }
  return createServiceClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
