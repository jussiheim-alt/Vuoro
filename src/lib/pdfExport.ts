import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { AppData, Lecture } from '../types'
import {
  isConventionKind,
  isSpecialProgramKind,
  lectureEventKind,
  scheduleTitleForLecture,
} from './eventKinds'
import { formatDateFi } from './storage'

function speakerOf(data: AppData, id: string) {
  return data.speakers.find((s) => s.id === id) ?? null
}

function themeOf(data: AppData, id: string) {
  return data.themes.find((t) => t.id === id) ?? null
}

function chairOf(data: AppData, id: string | null) {
  if (!id) return null
  return data.chairpersons.find((p) => p.id === id) ?? null
}

function readerOf(data: AppData, id: string | null) {
  if (!id) return null
  return data.readers.find((p) => p.id === id) ?? null
}

/** Strip wrapping quotes from theme title for schedule PDFs. */
function plainThemeTitle(name: string): string {
  const t = name.trim()
  if (
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith('\u201C') && t.endsWith('\u201D'))
  ) {
    return t.slice(1, -1).trim()
  }
  return t
}

/** Date like 6.9.2026 (no leading zeros) for filenames and list lines. */
export function formatDateShortFi(iso: string): string {
  const d = new Date(iso + 'T12:00:00')
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`
}

/** Confirmed/done presentations, sorted by date ascending. */
export function confirmedSchedule(data: AppData): Lecture[] {
  return data.lectures
    .filter((l) => l.status === 'confirmed' || l.status === 'done')
    .sort((a, b) => a.date.localeCompare(b.date))
}

export function scheduleRows(
  data: AppData,
  options: { fromDate?: string; toDate?: string } = {},
): Lecture[] {
  let rows = confirmedSchedule(data)
  if (options.fromDate) rows = rows.filter((l) => l.date >= options.fromDate!)
  if (options.toDate) rows = rows.filter((l) => l.date <= options.toDate!)
  return rows
}

export type SchedulePdfKind = 'ilmoitustaululle' | 'PJ'

export type BuiltSchedulePdf = {
  ok: true
  blob: Blob
  filename: string
  kind: SchedulePdfKind
  fromDate: string
  toDate: string
  entryCount: number
}

export type BuildSchedulePdfResult =
  | BuiltSchedulePdf
  | { ok: false; reason: string }

const FONT = 'DejaVu'

let fontCache: { normal: string; bold: string } | null = null

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

async function loadPdfFonts(): Promise<{ normal: string; bold: string }> {
  if (fontCache) return fontCache
  const [normalBuf, boldBuf] = await Promise.all([
    fetch('/fonts/DejaVuSans.ttf').then((r) => {
      if (!r.ok) throw new Error('DejaVuSans.ttf puuttuu')
      return r.arrayBuffer()
    }),
    fetch('/fonts/DejaVuSans-Bold.ttf').then((r) => {
      if (!r.ok) throw new Error('DejaVuSans-Bold.ttf puuttuu')
      return r.arrayBuffer()
    }),
  ])
  fontCache = {
    normal: bufToBase64(normalBuf),
    bold: bufToBase64(boldBuf),
  }
  return fontCache
}

async function createDoc(): Promise<jsPDF> {
  const fonts = await loadPdfFonts()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  doc.addFileToVFS('DejaVuSans.ttf', fonts.normal)
  doc.addFont('DejaVuSans.ttf', FONT, 'normal')
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fonts.bold)
  doc.addFont('DejaVuSans-Bold.ttf', FONT, 'bold')
  return doc
}

/**
 * Build notice-board or PJ schedule PDF matching the Vääksy sample layout:
 * left: date + theme; right: speaker + congregation (+ phone on PJ list);
 * indented puheenjohtaja / lukija rows.
 */
export async function buildCongregationSchedulePdf(
  data: AppData,
  kind: SchedulePdfKind,
  options: { fromDate?: string; toDate?: string } = {},
): Promise<BuildSchedulePdfResult> {
  const rows = scheduleRows(data, options)
  if (!rows.length) {
    return { ok: false, reason: 'Ei vahvistettuja esitelmiä valitulla välillä' }
  }

  const fromDate = rows[0]!.date
  const toDate = rows[rows.length - 1]!.date
  const first = formatDateShortFi(fromDate)
  const last = formatDateShortFi(toDate)
  const showPhones = kind === 'PJ'

  const doc = await createDoc()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  // Sample PDF uses bottom-up coords; jsPDF is top-down.
  // Convert sample anchors: title PDF-y 756 → top 86, first row PDF-y 716 → top 126
  const leftX = 51
  const rightX = 442
  const lineH = 14
  const entryGap = 13
  const bottomLimit = pageHeight - 40
  const chairLabel = 'Puheenjohtaja: '
  const readerLabel = 'Lukija: '

  let y = pageHeight - 756 // ≈ 86

  doc.setFont(FONT, 'bold')
  doc.setFontSize(16)
  doc.text('YLEISÖESITELMÄT VÄÄKSY', pageWidth / 2, y, { align: 'center' })
  y = pageHeight - 716 // ≈ 126

  doc.setFont(FONT, 'normal')
  doc.setFontSize(11)
  // Right-align dates so the year ends on one line; themes share one start X
  const dateColW = Math.max(
    ...rows.map((r) => doc.getTextWidth(formatDateShortFi(r.date))),
    doc.getTextWidth('00.00.0000'),
  )
  const dateEndX = leftX + dateColW
  const themeGap = doc.getTextWidth(' ')
  const themeX = dateEndX + themeGap
  const themeWrapW = Math.max(40, rightX - themeX - 24)
  // Roles align with the theme column
  const nameColX = themeX + doc.getTextWidth(chairLabel)

  for (const lec of rows) {
    const blockH = lineH * 4 + entryGap
    if (y + blockH > bottomLimit) {
      doc.addPage()
      y = pageHeight - 756
      doc.setFont(FONT, 'bold')
      doc.setFontSize(16)
      doc.text('YLEISÖESITELMÄT VÄÄKSY', pageWidth / 2, y, { align: 'center' })
      y = pageHeight - 716
      doc.setFont(FONT, 'normal')
      doc.setFontSize(11)
    }

    const kind = lectureEventKind(lec)
    const theme = themeOf(data, lec.themeId)
    const speaker = speakerOf(data, lec.speakerId)
    const chair = chairOf(data, lec.chairpersonId)
    const reader = readerOf(data, lec.readerId)

    const dateStr = formatDateShortFi(lec.date)
    const themeTitle = plainThemeTitle(
      scheduleTitleForLecture(lec, theme?.name ?? ''),
    )
    const speakerName =
      kind === 'talk' ? (speaker?.name ?? '') : ''
    const cong =
      kind === 'talk' ? (speaker?.congregation?.trim() ?? '') : ''
    const chairName =
      kind === 'talk' || isSpecialProgramKind(kind)
        ? (chair?.name ?? '')
        : ''
    const readerName = kind === 'talk' ? (reader?.name ?? '') : ''
    const chairPhone =
      showPhones && chairName && chair?.phone
        ? chair.phone.replace(/\s/g, '')
        : ''

    const themeLines = doc.splitTextToSize(themeTitle, themeWrapW) as string[]
    const startY = y

    // Row 1: right-aligned date · theme/event · speaker (talks only)
    doc.text(dateStr, dateEndX, startY, { align: 'right' })
    doc.text(themeLines[0] ?? '', themeX, startY)
    if (speakerName) doc.text(speakerName, rightX, startY)

    for (let i = 1; i < themeLines.length; i++) {
      doc.text(themeLines[i]!, themeX, startY + i * lineH)
    }

    if (cong) doc.text(cong, rightX, startY + lineH)

    if (isConventionKind(kind)) {
      // Date + event title only
      y = startY + Math.max(themeLines.length, 1) * lineH + entryGap
      continue
    }

    const usedLines =
      kind === 'talk' ? Math.max(themeLines.length, 2) : Math.max(themeLines.length, 1)
    y = startY + usedLines * lineH

    if (chairName || kind === 'talk' || isSpecialProgramKind(kind)) {
      doc.text(chairLabel, themeX, y)
      if (chairName) doc.text(chairName, nameColX, y)
      if (chairPhone) doc.text(chairPhone, rightX, y)
      y += lineH
    }

    if (kind === 'talk') {
      doc.text(readerLabel, themeX, y)
      if (readerName) doc.text(readerName, nameColX, y)
      y += lineH
    }

    y += entryGap
  }

  const suffix = kind === 'PJ' ? 'PJ' : 'ilmoitustaululle'
  const filename = `Esitelmät_${first}_${last}_${suffix}.pdf`
  const raw = doc.output('blob')
  const blob =
    raw.type === 'application/pdf'
      ? raw
      : new Blob([raw], { type: 'application/pdf' })

  return {
    ok: true,
    blob,
    filename,
    kind,
    fromDate,
    toDate,
    entryCount: rows.length,
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Build + download in one step (convenience). */
export async function exportCongregationSchedulePdf(
  data: AppData,
  kind: SchedulePdfKind,
  options: { fromDate?: string; toDate?: string } = {},
): Promise<{ ok: boolean; reason?: string }> {
  const built = await buildCongregationSchedulePdf(data, kind, options)
  if (!built.ok) return built
  downloadBlob(built.blob, built.filename)
  return { ok: true }
}

/** Legacy simple table export. */
export async function exportSchedulePdf(
  data: AppData,
  options: { title?: string; fromDate?: string; toDate?: string } = {},
): Promise<void> {
  const title = options.title ?? 'Esitelmäohjelma'
  const rows = scheduleRows(data, options)
  const doc = await createDoc()
  const pageWidth = doc.internal.pageSize.getWidth()

  doc.setFont(FONT, 'bold')
  doc.setFontSize(16)
  doc.text(title, pageWidth / 2, 48, { align: 'center' })

  doc.setFont(FONT, 'normal')
  doc.setFontSize(10)
  doc.text(
    `Tulostettu ${formatDateFi(new Date().toISOString().slice(0, 10))}`,
    pageWidth / 2,
    66,
    { align: 'center' },
  )

  if (!rows.length) {
    doc.setFontSize(12)
    doc.text('Ei vahvistettuja esitelmiä.', pageWidth / 2, 100, {
      align: 'center',
    })
  } else {
    autoTable(doc, {
      startY: 80,
      head: [['Päivämäärä', 'Puhuja', 'Teema', 'PJ', 'Lukija']],
      body: rows.map((l) => {
        const kind = lectureEventKind(l)
        return [
          formatDateFi(l.date),
          kind === 'talk' ? (speakerOf(data, l.speakerId)?.name ?? '—') : '—',
          plainThemeTitle(
            scheduleTitleForLecture(l, themeOf(data, l.themeId)?.name ?? ''),
          ),
          kind === 'talk' || isSpecialProgramKind(kind)
            ? (chairOf(data, l.chairpersonId)?.name ?? '—')
            : '—',
          kind === 'talk' ? (readerOf(data, l.readerId)?.name ?? '—') : '—',
        ]
      }),
      styles: { font: FONT, fontSize: 9, cellPadding: 3 },
      headStyles: {
        fillColor: [27, 61, 54],
        textColor: 255,
        font: FONT,
        fontStyle: 'bold',
      },
      alternateRowStyles: { fillColor: [240, 245, 241] },
    })
  }

  const stamp = new Date().toISOString().slice(0, 10)
  doc.save(`esitelmaohjelma-${stamp}.pdf`)
}
