import { redirect } from 'next/navigation'

// The printable walk sheet was absorbed into the site-visit sheet
// (2026-08-30): same checkbox layout under Print, plus due tasks, capex,
// PM items, litigation, and saved scratch notes. Old bookmarks land there.
export default function WalkSheetRedirect({ params }: { params: { id: string } }) {
  redirect(`/properties/${params.id}/site-visit`)
}
