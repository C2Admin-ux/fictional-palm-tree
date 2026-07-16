import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'
import { instanceLabel, type SectionInstance } from '@/lib/inspections/sections'
import { GRADE_HEX, type ScoreGrade } from '@/lib/inspections/score'
import { PRIORITY_LABELS, type ActionPriority } from '@/lib/inspections/templates'
import { PRIORITY_DOT } from '@/lib/utils'

// The inspection PDF report, rendered server-side (see
// app/api/inspections/[id]/report/route.ts). Data is fully resolved before
// rendering — photo bytes included — so this file stays a pure
// data → document mapping with no Supabase/network access.

// ── Data shapes ──────────────────────────────────────────────

// @react-pdf/renderer embeds JPEG and PNG only; the route filters photo
// formats down to these before handing them over.
export type ReportPhoto = { data: Buffer; format: 'jpg' | 'png' }

export type ReportItem = {
  section_name: string
  unit_number: string | null
  item_label: string
  requires_action: boolean
  action_priority: string | null
  photo_paths: string[]
}

export type ReportData = {
  propertyName: string
  pmcName: string | null
  typeLabel: string
  dateLabel: string
  inspectorName: string | null
  notes: string | null
  score: number
  grade: ScoreGrade
  openFindings: number
  // Same grouping the app renders — built with lib/inspections/sections.
  groups: { inst: SectionInstance; items: ReportItem[] }[]
  actionItems: ReportItem[]
  photos: Record<string, ReportPhoto>
  // Photos skipped (non-JPEG/PNG format) or that failed to download — the
  // report discloses the gap rather than silently rendering without them.
  omittedPhotos: number
}

// ── Styles ───────────────────────────────────────────────────
// Slate neutrals + blue-600 primary, matching the app's design system.

const SLATE_900 = '#0f172a'
const SLATE_600 = '#475569'
const SLATE_400 = '#94a3b8'
const SLATE_200 = '#e2e8f0'
const SLATE_100 = '#f1f5f9'
const SLATE_50 = '#f8fafc'
const BLUE_600 = '#2563eb'

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 52,
    paddingHorizontal: 44,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: SLATE_900,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: BLUE_600,
    paddingBottom: 12,
    marginBottom: 16,
  },
  lockup: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: SLATE_900, letterSpacing: 1 },
  lockupAccent: { color: BLUE_600 },
  reportTitle: { fontSize: 9, color: SLATE_600, marginTop: 3, letterSpacing: 2 },
  headerMeta: { alignItems: 'flex-end' },
  propertyName: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: SLATE_900 },
  metaLine: { fontSize: 9, color: SLATE_600, marginTop: 2 },

  // Score block
  scoreBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: SLATE_50,
    borderWidth: 1,
    borderColor: SLATE_200,
    borderRadius: 6,
    padding: 14,
    marginBottom: 16,
  },
  gradeBox: {
    width: 44,
    height: 44,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  gradeLetter: { fontSize: 24, fontFamily: 'Helvetica-Bold', color: '#ffffff' },
  scoreNumber: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: SLATE_900 },
  scoreLabel: { fontSize: 8, color: SLATE_400, marginTop: 2, letterSpacing: 1 },
  scoreDivider: { width: 1, height: 36, backgroundColor: SLATE_200, marginHorizontal: 18 },

  // Section headings
  sectionHeading: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    color: SLATE_600,
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 4,
  },

  // Action items table
  table: { borderWidth: 1, borderColor: SLATE_200, borderRadius: 4, marginBottom: 18 },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: SLATE_100,
    borderBottomWidth: 1,
    borderBottomColor: SLATE_200,
  },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: SLATE_100 },
  th: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: SLATE_600, padding: 6 },
  td: { fontSize: 9, color: SLATE_900, padding: 6 },
  colSection: { width: '28%' },
  colDescription: { width: '54%' },
  colPriority: { width: '18%' },

  // Findings
  groupHeading: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: SLATE_600,
    letterSpacing: 1,
    backgroundColor: SLATE_100,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 3,
    marginBottom: 6,
    marginTop: 8,
  },
  finding: {
    borderWidth: 1,
    borderColor: SLATE_200,
    borderRadius: 4,
    padding: 8,
    marginBottom: 8,
  },
  findingHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  findingLabel: { fontSize: 9.5, color: SLATE_900, flex: 1, paddingRight: 8 },
  findingLabelEmpty: { fontSize: 9.5, color: SLATE_400 },
  priorityBadge: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 8,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  photo: {
    width: '48.5%',
    height: 170,
    objectFit: 'contain',
    backgroundColor: SLATE_50,
    borderWidth: 1,
    borderColor: SLATE_100,
    borderRadius: 3,
    marginBottom: 6,
    marginRight: '1.5%',
  },

  notes: { fontSize: 9, color: SLATE_600, marginBottom: 14, lineHeight: 1.4 },
  empty: { fontSize: 9, color: SLATE_400, marginBottom: 14 },
  omittedNote: { fontSize: 8, color: SLATE_400, marginTop: -10, marginBottom: 14 },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: SLATE_100,
    paddingTop: 6,
  },
  footerText: { fontSize: 7.5, color: SLATE_400 },
})

// ── Components ───────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: string | null }) {
  const key = priority ?? 'medium'
  return (
    <Text style={[styles.priorityBadge, { backgroundColor: PRIORITY_DOT[key] ?? SLATE_400 }]}>
      {PRIORITY_LABELS[key as ActionPriority] ?? key}
    </Text>
  )
}

function Finding({ item, photos }: { item: ReportItem; photos: Record<string, ReportPhoto> }) {
  const embeddable = item.photo_paths.filter(p => photos[p])
  return (
    // Keep a finding on one page unless it's so photo-heavy (3+ rows of the
    // 2-up grid) that forcing it unbroken could overflow a whole page.
    <View style={styles.finding} wrap={embeddable.length > 4}>
      <View style={styles.findingHead}>
        <Text style={item.item_label ? styles.findingLabel : styles.findingLabelEmpty}>
          {item.item_label || 'No description'}
        </Text>
        {item.requires_action && <PriorityBadge priority={item.action_priority} />}
      </View>
      {embeddable.length > 0 && (
        <View style={styles.photoGrid}>
          {embeddable.map(path => (
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image key={path} style={styles.photo} src={photos[path]} />
          ))}
        </View>
      )}
    </View>
  )
}

export function InspectionReport({ data }: { data: ReportData }) {
  const gradeColor = GRADE_HEX[data.grade]
  return (
    <Document
      title={`Inspection Report — ${data.propertyName} — ${data.dateLabel}`}
      author="C2 Capital">
      <Page size="LETTER" style={styles.page}>
        {/* Header */}
        <View style={styles.header} fixed>
          <View>
            <Text style={styles.lockup}>
              C2 <Text style={styles.lockupAccent}>CAPITAL</Text>
            </Text>
            <Text style={styles.reportTitle}>PROPERTY INSPECTION REPORT</Text>
          </View>
          <View style={styles.headerMeta}>
            <Text style={styles.propertyName}>{data.propertyName}</Text>
            <Text style={styles.metaLine}>{data.typeLabel} Inspection · {data.dateLabel}</Text>
            {data.inspectorName && <Text style={styles.metaLine}>Inspected by {data.inspectorName}</Text>}
            {data.pmcName && <Text style={styles.metaLine}>Managed by {data.pmcName}</Text>}
          </View>
        </View>

        {/* Score block */}
        <View style={styles.scoreBlock}>
          <View style={[styles.gradeBox, { backgroundColor: gradeColor }]}>
            <Text style={styles.gradeLetter}>{data.grade}</Text>
          </View>
          <View>
            <Text style={styles.scoreNumber}>{data.score} / 100</Text>
            <Text style={styles.scoreLabel}>PROPERTY SCORE</Text>
          </View>
          <View style={styles.scoreDivider} />
          <View>
            <Text style={styles.scoreNumber}>{data.openFindings}</Text>
            <Text style={styles.scoreLabel}>OPEN FINDING{data.openFindings === 1 ? '' : 'S'} REQUIRING ACTION</Text>
          </View>
        </View>

        {/* Missing-photo transparency, tucked under the score block */}
        {data.omittedPhotos > 0 && (
          <Text style={styles.omittedNote}>
            {data.omittedPhotos} photo{data.omittedPhotos === 1 ? '' : 's'} could not be included in this report.
          </Text>
        )}

        {/* Inspection notes */}
        {data.notes && <Text style={styles.notes}>{data.notes}</Text>}

        {/* Action items first — the part a PM acts on */}
        <Text style={styles.sectionHeading}>ACTION ITEMS</Text>
        {data.actionItems.length === 0 ? (
          <Text style={styles.empty}>No action items — nothing flagged for follow-up.</Text>
        ) : (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={[styles.th, styles.colSection]}>Section / Unit</Text>
              <Text style={[styles.th, styles.colDescription]}>Description</Text>
              <Text style={[styles.th, styles.colPriority]}>Priority</Text>
            </View>
            {data.actionItems.map((item, i) => (
              <View key={i} style={styles.tableRow} wrap={false}>
                <Text style={[styles.td, styles.colSection]}>
                  {instanceLabel({ name: item.section_name, unit: item.unit_number })}
                </Text>
                <Text style={[styles.td, styles.colDescription]}>{item.item_label || '—'}</Text>
                <View style={[styles.td, styles.colPriority, { flexDirection: 'row' }]}>
                  <PriorityBadge priority={item.action_priority} />
                </View>
              </View>
            ))}
          </View>
        )}

        {/* All findings, grouped exactly as the app groups them */}
        <Text style={styles.sectionHeading}>FINDINGS BY SECTION</Text>
        {data.groups.length === 0 && <Text style={styles.empty}>No findings recorded.</Text>}
        {data.groups.map(({ inst, items }) => (
          <View key={`${inst.name}|${inst.unit ?? ''}`}>
            {/* minPresenceAhead keeps a group heading from orphaning at a
                page bottom with its findings on the next page. */}
            <Text style={styles.groupHeading} minPresenceAhead={90}>{instanceLabel(inst).toUpperCase()}</Text>
            {items.map((item, i) => <Finding key={i} item={item} photos={data.photos} />)}
          </View>
        ))}

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>C2 Capital · Property Inspection Report · {data.propertyName}</Text>
          <Text style={styles.footerText}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

// Render to PDF bytes — the only entry point the API route needs.
export async function renderInspectionReport(data: ReportData): Promise<Buffer> {
  return renderToBuffer(<InspectionReport data={data} />)
}
