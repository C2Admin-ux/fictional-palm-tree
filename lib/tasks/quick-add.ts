// Natural-language quick-add parser. Pure and client-side: turns
// "call plumber fox hill tomorrow !urgent" into structured task fields
// with the matched tokens stripped from the title. Matched tokens are
// echoed back so the quick-add bar can preview chips as the user types.

import { todayISO } from '@/lib/utils'
import { tomorrowISO, nextMondayISO, nextWeekdayISO } from '@/lib/tasks/dates'

export type QuickAddProperty = { id: string; name: string }

export type ParsedQuickAdd = {
  title: string
  due_date?: string
  priority?: 'low' | 'high' | 'urgent'
  property_id?: string
  matchedTokens: string[]
}

// Optional connector words stripped along with a date token
// ("due friday" → both words go).
const PRE_DATE = String.raw`(?:\b(?:on|by|due)\s+)?`

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tues: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thurs: 4, thur: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

// Single words from a property name that are too generic to identify
// the property on their own (multi-word grams may still include them).
const PROPERTY_STOPWORDS = new Set([
  'the', 'and', 'on', 'at', 'of', 'in', 'for', 'a', 'an', 'to',
  'new', 'old', 'main', 'north', 'south', 'east', 'west', 'san',
  'apartment', 'apartments', 'street', 'place', 'park', 'house',
  'ii', 'iii', 'iv',
])

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Build yyyy-MM-dd from a month/day (and optional explicit year),
// inferring the next occurrence when the year is omitted.
function buildMonthDay(month: number, day: number, yearRaw: string | undefined, today: string): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  let year: number
  if (yearRaw) {
    year = yearRaw.length === 2 ? 2000 + parseInt(yearRaw, 10) : parseInt(yearRaw, 10)
  } else {
    year = parseInt(today.slice(0, 4), 10)
    const candidate = `${year}-${pad2(month)}-${pad2(day)}`
    if (candidate < today) year += 1
  }
  if (day > daysInMonth(year, month)) return null
  return `${year}-${pad2(month)}-${pad2(day)}`
}

type Found = { value: string; match: RegExpExecArray }

function findDate(s: string, today: string): Found | null {
  let re = new RegExp(PRE_DATE + String.raw`\b(?:today|tod)\b`, 'i')
  let m = re.exec(s)
  if (m) return { value: today, match: m }

  re = new RegExp(PRE_DATE + String.raw`\b(?:tomorrow|tmr)\b`, 'i')
  m = re.exec(s)
  if (m) return { value: tomorrowISO(today), match: m }

  re = new RegExp(PRE_DATE + String.raw`\bnext\s+week\b`, 'i')
  m = re.exec(s)
  if (m) return { value: nextMondayISO(today), match: m }

  const weekdayAlt = Object.keys(WEEKDAYS).sort((a, b) => b.length - a.length).join('|')
  re = new RegExp(PRE_DATE + String.raw`\b(` + weekdayAlt + String.raw`)\b`, 'i')
  m = re.exec(s)
  if (m) return { value: nextWeekdayISO(WEEKDAYS[m[1].toLowerCase()], today), match: m }

  // M/D and M/D/YYYY
  re = new RegExp(PRE_DATE + String.raw`\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b`)
  m = re.exec(s)
  if (m) {
    const date = buildMonthDay(parseInt(m[1], 10), parseInt(m[2], 10), m[3], today)
    if (date) return { value: date, match: m }
  }

  // "aug 15" / "august 15th" style
  const monthAlt = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|')
  re = new RegExp(PRE_DATE + String.raw`\b(` + monthAlt + String.raw`)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b`, 'i')
  m = re.exec(s)
  if (m) {
    const date = buildMonthDay(MONTHS[m[1].toLowerCase()], parseInt(m[2], 10), undefined, today)
    if (date) return { value: date, match: m }
  }

  return null
}

// Longest word-sequence from any property name found in the input
// wins. Single-word grams must be ≥3 chars and non-generic so "fix
// main door" doesn't hijack Main Street Apartments.
function findProperty(s: string, properties: QuickAddProperty[]): { id: string; gram: string; match: RegExpExecArray } | null {
  let best: { id: string; gram: string; match: RegExpExecArray } | null = null
  for (const p of properties) {
    const words = p.name.toLowerCase().split(/\s+/).filter(Boolean)
    for (let i = 0; i < words.length; i++) {
      for (let j = words.length; j > i; j--) {
        const gram = words.slice(i, j).join(' ')
        if (j - i === 1 && (gram.length < 3 || PROPERTY_STOPWORDS.has(gram))) continue
        if (j - i > 1 && gram.length < 5) continue
        if (best && gram.length <= best.gram.length) continue
        const re = new RegExp(
          String.raw`(?:\b(?:at|for)\s+|@)?\b` + escapeRegExp(gram).replace(/ /g, String.raw`\s+`) + String.raw`\b`,
          'i'
        )
        const m = re.exec(s)
        if (m) best = { id: p.id, gram, match: m }
      }
    }
  }
  return best
}

function strip(s: string, m: RegExpExecArray): string {
  return s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)
}

export function parseQuickAdd(
  input: string,
  properties: QuickAddProperty[] = [],
  opts?: { today?: string }
): ParsedQuickAdd {
  const today = opts?.today ?? todayISO()
  let s = input
  const matchedTokens: string[] = []
  const out: ParsedQuickAdd = { title: '', matchedTokens }

  // 1. "!urgent" / "!high" / "!low" anywhere
  const bang = /(?:^|\s)!(urgent|high|low)\b/i.exec(s)
  if (bang) {
    out.priority = bang[1].toLowerCase() as ParsedQuickAdd['priority']
    matchedTokens.push(`!${bang[1].toLowerCase()}`)
    s = strip(s, bang)
  }

  // 2. Date (first matching pattern wins)
  const date = findDate(s, today)
  if (date) {
    out.due_date = date.value
    matchedTokens.push(date.match[0].trim())
    s = strip(s, date.match)
  }

  // 3. Bare "urgent"/"high"/"low" as the trailing word (after date
  //    removal so "call bob urgent tomorrow" still counts as trailing)
  if (!out.priority) {
    const trailing = /(?:^|\s)(urgent|high|low)[\s.!]*$/i.exec(s)
    if (trailing) {
      out.priority = trailing[1].toLowerCase() as ParsedQuickAdd['priority']
      matchedTokens.push(trailing[1].toLowerCase())
      s = strip(s, trailing)
    }
  }

  // 4. Property (callers with a property preset pass an empty list)
  if (properties.length > 0) {
    const prop = findProperty(s, properties)
    if (prop) {
      out.property_id = prop.id
      matchedTokens.push(prop.match[0].trim())
      s = strip(s, prop.match)
    }
  }

  out.title = s
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;·–—-]+|[\s,;·–—-]+$/g, '')
  return out
}
