# C2Admin

Internal real-estate portfolio management platform for C2 Capital. Modules:

- **Dashboard** — portfolio overview
- **Tasks** — action items, including auto-generated expiration tasks
- **CapEx** — capital-expenditure tracking
- **Insurance** — policies and claims
- **Documents / Contracts** — uploads with Claude-powered OCR extraction
- **Performance** — property-manager performance
- **Properties** — property records and PCA / building data
- **Inspections, Reports, Settings**

## Stack

- [Next.js 14](https://nextjs.org) App Router, TypeScript (`strict`)
- Tailwind CSS with design tokens in `app/globals.css`
- [Supabase](https://supabase.com) — Postgres, Auth, Storage (`lib/supabase/`)
- Anthropic API for document extraction — all calls go through `lib/anthropic.ts`
- [Resend](https://resend.com) for outbound email (digest)

## Local setup

```bash
git clone https://github.com/C2Admin-ux/c2-repo.git
cd c2-repo
npm install
cp .env.example .env.local   # then fill in real values
npm run dev                  # http://localhost:3000
```

Every variable the code reads is documented in [.env.example](.env.example).

## Scripts

| Script              | What it does                       |
| ------------------- | ---------------------------------- |
| `npm run dev`       | Start the dev server               |
| `npm run build`     | Production build                   |
| `npm run start`     | Serve the production build         |
| `npm run lint`      | ESLint (`next lint`)               |
| `npm run typecheck` | TypeScript check (`tsc --noEmit`)  |

## Deployment

Push to `main` → Vercel builds and deploys automatically. Environment
variables live in Vercel → Settings → Environment Variables.

## API-route auth model

Two credentials, both validated per-route via `lib/api-auth.ts`:

- **Session** — logged-in Supabase user (browser-facing routes).
- **Bearer `CRON_SECRET`** — server-to-server / Vercel Cron calls
  (`isCronRequest()` is fail-closed: no secret configured means no access).

`middleware.ts` (via `lib/supabase/middleware.ts`) is deny-by-default:
unauthenticated page requests redirect to `/auth/login`; unauthenticated API
requests get 401 JSON. Requests carrying an `Authorization` header pass
through to the route, which still validates the credential itself —
middleware never grants access on its own.

## Automation currently ON HOLD

As of 2026-07-13 all scheduled automation is intentionally disabled:

- **Both crons removed from `vercel.json`** (`"crons": []`):
  - Weekly digest — route still callable manually from Settings → Digest.
    Re-enable notes at the top of `app/api/digest/route.ts`.
  - Nightly expiration-task creation — still callable with Bearer
    `CRON_SECRET`. Re-enable notes (including the snooze-clearing step that
    must be recreated) at the top of `app/api/tasks/expiration/route.ts`.
- **Gmail inbox scan disabled** — `GMAIL_SCAN_ENABLED = false` in
  `app/api/digest/route.ts` until a Gmail MCP OAuth credential
  (`GMAIL_MCP_AUTH_TOKEN`) is provisioned.
