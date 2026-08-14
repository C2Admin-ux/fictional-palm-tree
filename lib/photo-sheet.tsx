import React from 'react'
import {
  Document, Page, View, Text, Image, StyleSheet, renderToBuffer,
} from '@react-pdf/renderer'

// The photo sheet — a captioned 3×3 photo grid, rendered server-side and
// meant to be attached to a follow-up email so recipients can see the
// photos without an app login. Shared by inspections
// (app/api/inspections/[id]/photo-sheet) and capex projects
// (app/api/capex/[id]/photo-sheet), so both produce the same document.
//
// Deliberately NOT the inspection report: no score, no findings tables, no
// narrative. Photos and their captions, nothing else. The report
// (lib/inspections/report.tsx) remains the standalone record.
//
// Like the report, this file is a pure data → document mapping: photo
// bytes are resolved by the route before rendering, no network access here.

// ── Data shapes ──────────────────────────────────────────────

// @react-pdf/renderer embeds JPEG and PNG only; routes filter photo
// formats down to these before handing them over.
export type SheetImage = { data: Buffer; format: 'jpg' | 'png' }

export type SheetPhoto = {
  image: SheetImage
  // Bold locator line — "Bldg 3 Roof · Unit 204" for a finding, the
  // project title for a capex photo. Optional.
  heading: string | null
  // The note under the photo. For inspections this is the finding
  // description (auto); for capex it's the hand-written caption.
  caption: string | null
}

export type PhotoSheetData = {
  propertyName: string
  // Small letter-spaced line under the lockup — "PHOTO LOG" / "PROJECT PHOTOS".
  documentTitle: string
  // Right-hand header lines under the property name (type, date, etc.).
  metaLines: string[]
  photos: SheetPhoto[]
  // Photos skipped (non-JPEG/PNG) or that failed to download — disclosed
  // on the sheet rather than silently dropped, same as the report.
  omittedPhotos: number
}

// Exactly nine to a page. Chunking explicitly (rather than letting a
// wrapping flex row paginate itself) keeps every page a full, aligned 3×3
// grid instead of a ragged break mid-row.
export const PHOTOS_PER_PAGE = 9
const COLUMNS = 3

// Captions are truncated rather than allowed to grow the row: three rows
// of images must fit one page, and a long finding description would push
// the third row off. ~2 lines at 7.5pt in a 165pt column.
const MAX_HEADING = 44
const MAX_CAPTION = 82

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

export function chunkPhotos(photos: SheetPhoto[]): SheetPhoto[][] {
  const pages: SheetPhoto[][] = []
  for (let i = 0; i < photos.length; i += PHOTOS_PER_PAGE) {
    pages.push(photos.slice(i, i + PHOTOS_PER_PAGE))
  }
  return pages
}

// ── Styles ───────────────────────────────────────────────────
// Slate neutrals + blue-600 primary, matching the app's design system
// and the inspection report.

const SLATE_900 = '#0f172a'
const SLATE_600 = '#475569'
const SLATE_400 = '#94a3b8'
const SLATE_100 = '#f1f5f9'
const SLATE_50 = '#f8fafc'
const BLUE_600 = '#2563eb'

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 36,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: SLATE_900,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: BLUE_600,
    paddingBottom: 10,
    marginBottom: 12,
  },
  lockup: { fontSize: 14, fontFamily: 'Helvetica-Bold', color: SLATE_900, letterSpacing: 1 },
  lockupAccent: { color: BLUE_600 },
  documentTitle: { fontSize: 8, color: SLATE_600, marginTop: 3, letterSpacing: 2 },
  headerMeta: { alignItems: 'flex-end' },
  propertyName: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: SLATE_900 },
  metaLine: { fontSize: 8.5, color: SLATE_600, marginTop: 2 },

  omittedNote: { fontSize: 8, color: SLATE_400, marginBottom: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / COLUMNS}%`, padding: 4 },
  photo: {
    width: '100%',
    height: 160,
    objectFit: 'contain',
    backgroundColor: SLATE_50,
    borderWidth: 1,
    borderColor: SLATE_100,
    borderRadius: 3,
  },
  heading: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: SLATE_900, marginTop: 4 },
  caption: { fontSize: 7.5, color: SLATE_600, marginTop: 1, lineHeight: 1.25 },

  empty: { fontSize: 9, color: SLATE_400 },

  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: SLATE_100,
    paddingTop: 6,
  },
  footerText: { fontSize: 7.5, color: SLATE_400 },
})

// ── Components ───────────────────────────────────────────────

function PhotoCell({ photo, index }: { photo: SheetPhoto; index: number }) {
  return (
    // wrap={false} is belt-and-braces: chunking already guarantees a cell
    // never straddles a page, but a cell must never split internally.
    <View style={styles.cell} wrap={false}>
      {/* eslint-disable-next-line jsx-a11y/alt-text */}
      <Image style={styles.photo} src={photo.image} />
      <Text style={styles.heading}>
        {index}. {photo.heading ? truncate(photo.heading, MAX_HEADING) : ''}
      </Text>
      {photo.caption && (
        <Text style={styles.caption}>{truncate(photo.caption, MAX_CAPTION)}</Text>
      )}
    </View>
  )
}

export function PhotoSheet({ data }: { data: PhotoSheetData }) {
  const pages = chunkPhotos(data.photos)
  return (
    <Document
      title={`${data.documentTitle} — ${data.propertyName}`}
      author="C2 Capital">
      {/* An empty sheet still renders one page saying so — a zero-page PDF
          is invalid, and the routes reject empty selections anyway. */}
      {(pages.length === 0 ? [[]] : pages).map((pagePhotos, pageIndex) => (
        <Page key={pageIndex} size="LETTER" style={styles.page}>
          <View style={styles.header}>
            <View>
              <Text style={styles.lockup}>
                C2 <Text style={styles.lockupAccent}>CAPITAL</Text>
              </Text>
              <Text style={styles.documentTitle}>{data.documentTitle}</Text>
            </View>
            <View style={styles.headerMeta}>
              <Text style={styles.propertyName}>{data.propertyName}</Text>
              {data.metaLines.map((line, i) => (
                <Text key={i} style={styles.metaLine}>{line}</Text>
              ))}
            </View>
          </View>

          {/* Disclose omissions once, on the first page */}
          {pageIndex === 0 && data.omittedPhotos > 0 && (
            <Text style={styles.omittedNote}>
              {data.omittedPhotos} photo{data.omittedPhotos === 1 ? '' : 's'} could not be included in this sheet.
            </Text>
          )}

          {pagePhotos.length === 0 ? (
            <Text style={styles.empty}>No photos selected.</Text>
          ) : (
            <View style={styles.grid}>
              {pagePhotos.map((photo, i) => (
                <PhotoCell
                  key={i}
                  photo={photo}
                  index={pageIndex * PHOTOS_PER_PAGE + i + 1}
                />
              ))}
            </View>
          )}

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>
              C2 Capital · {data.documentTitle} · {data.propertyName}
            </Text>
            <Text style={styles.footerText}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
          </View>
        </Page>
      ))}
    </Document>
  )
}

// Render to PDF bytes — the only entry point the API routes need.
export async function renderPhotoSheet(data: PhotoSheetData): Promise<Buffer> {
  return renderToBuffer(<PhotoSheet data={data} />)
}
