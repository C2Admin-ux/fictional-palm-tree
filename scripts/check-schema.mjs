// Schema drift check: every column and table the code names in a PostgREST
// call, verified against the LIVE database.
//
// Why this exists: on 2026-08-11 the inspections page died mid-walk with
// "column inspection_items_1.disposition does not exist" — migration 0011
// was committed and deployed, but never run in Supabase. The same audit
// found capex_bids (0009) and alert_settings (0007) missing too. Nothing
// in the build catches this: TypeScript checks against types.ts, which is
// hand-maintained and therefore drifts with the code, not with the database.
//
//   npm run check:schema
//
// Reads NEXT_PUBLIC_SUPABASE_URL + a key from the environment or .env.local,
// then GETs PostgREST's OpenAPI document — schema shape only, no table data.
// Exits 1 on drift so it can gate a deploy.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SKIP_DIRS = new Set(['.next', '.git', 'node_modules', '.claude', '.vercel', 'scripts'])
// Views and RPC-only relations PostgREST exposes without columns we select.
const IGNORE_TABLES = new Set()

function loadEnv() {
  const env = { ...process.env }
  const file = path.join(ROOT, '.env.local')
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
      if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

async function liveSchema() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.error('check:schema — no Supabase URL/key found (env or .env.local). Skipping.')
    process.exit(0)
  }
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`)
  const spec = await res.json()
  const out = {}
  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    out[name] = new Set(Object.keys(def.properties ?? {}))
  }
  return out
}

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) sourceFiles(path.join(dir, e.name), out) }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(path.join(dir, e.name))
  }
  return out
}

// Split a select string on top-level commas, keeping embed bodies intact.
function splitTop(s) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(p => p.trim()).filter(Boolean)
}

const FILTERS = 'eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps'

async function main() {
  const schema = await liveSchema()
  const findings = []
  const add = (file, line, table, col, kind) => findings.push({ file, line, table, col, kind })

  const check = (table, col, file, line, kind) => {
    if (IGNORE_TABLES.has(table)) return
    const cols = schema[table]
    if (!cols) { add(file, line, table, col, `${kind} · table not in database`); return }
    if (!cols.has(col)) add(file, line, table, col, `${kind} · column not in database`)
  }

  const checkSelect = (table, sel, file, line) => {
    if (!schema[table]) { add(file, line, table, '*', 'select · table not in database'); return }
    for (const part of splitTop(sel)) {
      const embed = /^([a-z_]+)(?:!\w+)?\s*\(([\s\S]*)\)$/.exec(part)
      if (embed) {
        // Unresolvable names are FK-relationship aliases, not tables — skip.
        if (schema[embed[1]]) checkSelect(embed[1], embed[2], file, line)
        continue
      }
      if (part === '*' || part.includes(':')) continue
      const col = part.replace(/\.\.\..*/, '').trim()
      if (/^[a-z_][a-z0-9_]*$/.test(col)) check(table, col, file, line, 'select')
    }
  }

  for (const file of sourceFiles(ROOT)) {
    const src = fs.readFileSync(file, 'utf8')
    const rel = path.relative(ROOT, file).replace(/\\/g, '/')
    const lineOf = i => src.slice(0, i).split('\n').length

    // Select strings pulled out into a shared const, resolved by name so
    // `.select(WATCH_ROW_SELECT)` is checked like an inline literal.
    const namedSelects = new Map()
    for (const c of src.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*'([^']+)'/g)) namedSelects.set(c[1], c[2])

    // Each .from('table') opens a chain; scan forward to the next .from(.
    const froms = [...src.matchAll(/\.from\(\s*'([a-z_]+)'\s*\)/g)]
    for (let i = 0; i < froms.length; i++) {
      const m = froms[i]
      const start = m.index + m[0].length
      const end = i + 1 < froms.length ? froms[i + 1].index : Math.min(src.length, start + 2500)
      const chain = src.slice(start, end)
      const table = m[1]
      const ln = lineOf(m.index)

      for (const s of chain.matchAll(/\.select\(\s*'([^']*)'/g)) checkSelect(table, s[1], rel, ln)
      for (const s of chain.matchAll(/\.select\(\s*([A-Z][A-Z0-9_]*)\s*[),]/g)) {
        const literal = namedSelects.get(s[1])
        if (literal) checkSelect(table, literal, rel, ln)
      }
      for (const f of chain.matchAll(new RegExp(`\\.(?:${FILTERS})\\(\\s*'([^']+)'`, 'g'))) {
        const [t, c] = f[1].includes('.') ? f[1].split('.') : [table, f[1]]
        if (schema[t]) check(t, c, rel, ln, 'filter')
        else if (t === table) check(table, f[1], rel, ln, 'filter')
      }
      for (const o of chain.matchAll(/\.order\(\s*'([a-z_]+)'/g)) check(table, o[1], rel, ln, 'order')
      // Write payloads: an unknown key 400s exactly like a bad select.
      for (const w of chain.matchAll(/\.(?:insert|update|upsert)\(\s*\{([\s\S]{0,900}?)\}\s*\)/g)) {
        for (const k of w[1].matchAll(/(?:^|[,{\n])\s*([a-z_][a-z0-9_]*)\s*:/g)) check(table, k[1], rel, ln, 'write')
      }
    }
  }

  const seen = new Set()
  const uniq = findings.filter(f => {
    const k = `${f.file}:${f.table}.${f.col}:${f.kind}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  if (uniq.length === 0) {
    console.log(`check:schema — OK, every column the code names exists in the database (${Object.keys(schema).length} tables).`)
    return
  }

  console.error(`check:schema — ${uniq.length} reference(s) the database does not have.`)
  console.error('An unapplied migration in supabase/migrations is the usual cause.\n')
  for (const f of uniq) console.error(`  ${f.file}:${f.line}  ${f.table}.${f.col}  [${f.kind}]`)
  console.error('')
  process.exit(1)
}

main().catch(err => { console.error('check:schema failed:', err.message); process.exit(1) })
