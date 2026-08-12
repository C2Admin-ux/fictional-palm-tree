// Schema-gap errors: the app asked for a column or table the database does
// not have. Always the same cause — code shipped ahead of its migration —
// and always fixed the same way: run the pending SQL in supabase/migrations.
//
// This is a distinct failure class from "the network hiccuped". A retry
// never helps, so surfaces must say what is actually wrong instead of
// showing a raw Postgres string (or, worse, a blank page mid-walk). See
// scripts/check-schema.mjs for the pre-deploy check that stops it reaching
// production in the first place.

export type SchemaGap = {
  /** 'inspection_items.disposition' or 'capex_bids' — what the DB is missing. */
  missing: string | null
  /** Ready-to-render sentence for the UI. */
  message: string
}

// PostgREST/Postgres codes that mean "this column/table/relationship is not
// in the database", as opposed to a permission, constraint, or network fault.
const SCHEMA_GAP_CODES = new Set([
  '42703', // undefined_column
  '42P01', // undefined_table
  'PGRST200', // embed target not found (relationship missing)
  'PGRST204', // column not found in schema cache
  'PGRST205', // table not found in schema cache
])

type MaybeError = { code?: string | null; message?: string | null } | null | undefined

export function isSchemaGapError(error: MaybeError): boolean {
  if (!error) return false
  if (error.code && SCHEMA_GAP_CODES.has(error.code)) return true
  // Some transports drop the code; the message shapes are stable enough.
  const m = error.message ?? ''
  return /does not exist|in the schema cache/i.test(m) && /column|table|relation/i.test(m)
}

// PostgREST aliases embedded tables ('inspection_items_1.disposition'). The
// trailing index is noise to a reader — strip it so the name matches what
// the migration file actually creates.
const dealias = (qualified: string) => qualified.replace(/_\d+(?=\.)/, '')

export function describeSchemaGap(error: MaybeError): SchemaGap {
  const raw = error?.message ?? ''

  const column = /column ([\w.]+) does not exist/i.exec(raw)
  if (column) {
    const missing = dealias(column[1])
    return { missing, message: `the database is missing the "${missing}" column` }
  }

  const table =
    /(?:table|relation) ['"]?(?:public\.)?([\w.]+)['"]? (?:does not exist|in the schema cache)/i.exec(raw) ||
    /Could not find the table ['"](?:public\.)?([\w.]+)['"]/i.exec(raw)
  if (table) {
    const missing = dealias(table[1])
    return { missing, message: `the database is missing the "${missing}" table` }
  }

  return { missing: null, message: 'the database is missing something this page needs' }
}

// One sentence for a banner: what is missing and what fixes it. Deliberately
// names the migrations folder — the fix is always a SQL file already sitting
// in the repo, not a code change.
export function schemaGapMessage(error: MaybeError): string {
  const { message } = describeSchemaGap(error)
  return `${message.charAt(0).toUpperCase()}${message.slice(1)} — a migration in supabase/migrations hasn't been run yet. Nothing is lost; applying it restores this view.`
}
