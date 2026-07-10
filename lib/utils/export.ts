import * as XLSX from 'xlsx'

// Generic: takes an array of flat row objects and downloads an .xlsx
export function exportToExcel(rows: Record<string, any>[], filename: string, sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows)

  // Auto-size columns based on the longest value (capped) in each.
  const keys = rows.length ? Object.keys(rows[0]) : []
  ws['!cols'] = keys.map(k => {
    const headerLen = k.length
    const maxCell = rows.reduce((m, r) => {
      const v = r[k] == null ? '' : String(r[k])
      return Math.max(m, v.length)
    }, 0)
    return { wch: Math.min(Math.max(headerLen, maxCell) + 2, 50) }
  })

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `${filename}_${stamp}.xlsx`)
}

// Formatters so the spreadsheet is clean/readable
export function fmtDate(d: string | null | undefined) {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function fmtMoney(n: number | null | undefined) {
  if (n == null) return ''
  return n
}

export function yesNo(b: boolean | null | undefined) {
  if (b == null) return ''
  return b ? 'Yes' : 'No'
}

export function titleCase(s: string | null | undefined) {
  if (!s) return ''
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
