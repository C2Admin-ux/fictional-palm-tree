import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // Deny-by-default gate, with the response type matched to the caller:
  //
  //  - Pages: unauthenticated requests redirect to /auth/login.
  //  - API routes: unauthenticated requests get 401 JSON — never a redirect.
  //    (Redirecting /api/* was the bug that silently prevented Vercel Cron,
  //    which sends a bearer token but no session cookie, from ever running.)
  //    Requests carrying an Authorization header pass through so bearer-auth
  //    callers (cron) reach the route — every route still validates its own
  //    credential (session or Bearer CRON_SECRET), so middleware passing a
  //    request through never grants access by itself.
  const isApi = request.nextUrl.pathname.startsWith('/api')
  // Webhook endpoints that authenticate with their own fail-closed scheme
  // (svix signatures / shared-secret tokens) and whose callers cannot send
  // an Authorization header. Passing through grants nothing: each route
  // rejects unauthenticated requests itself.
  const isSignedWebhook = request.nextUrl.pathname === '/api/calls/inbound'
  if (!user && isApi && !isSignedWebhook && !request.headers.get('authorization')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!user && !isApi && !request.nextUrl.pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
