import * as XLSX from 'xlsx'
import type { Lecture, Speaker, Theme } from '../types'
import { uid } from './storage'

function cellStr(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    // Excel serial date?
    if (v > 30000 && v < 60000) {
      const epoch = new Date(Date.UTC(1899, 11, 30))
      const d = new Date(epoch.getTime() + v * 86400000)
      return d.toISOString().slice(0, 10)
    }
    return String(v)
  }
  const s = String(v).trim()
  // dd.mm.yyyy or d.m.yyyy
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return s
}

function pick(
  row: Record<string, unknown>,
  keys: string[],
): string {
  const entries = Object.entries(row).map(([k, v]) => [
    k.trim().toLowerCase(),
    cellStr(v),
  ])
  const map = Object.fromEntries(entries)
  for (const key of keys) {
    const val = map[key.toLowerCase()]
    if (val) return val
  }
  // partial match
  for (const [k, v] of entries) {
    if (keys.some((key) => k.includes(key.toLowerCase())) && v) return v
  }
  return ''
}

function sheetToRows(wb: XLSX.WorkBook, sheetName?: string): Record<string, unknown>[] {
  const name = sheetName ?? wb.SheetNames[0]
  if (!name) return []
  const sheet = wb.Sheets[name]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  })
}

export type ExcelImportResult = {
  themes: Theme[]
  speakers: Speaker[]
  history: Array<{
    date: string
    themeName: string
    speakerName: string
  }>
  sheetNames: string[]
  notes: string[]
}

export function parseExcelWorkbook(buffer: ArrayBuffer): ExcelImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const notes: string[] = []
  const themes: Theme[] = []
  const speakers: Speaker[] = []
  const history: ExcelImportResult['history'] = []
  const themeSeen = new Set<string>()
  const speakerSeen = new Set<string>()

  for (const sheetName of wb.SheetNames) {
    const rows = sheetToRows(wb, sheetName)
    if (!rows.length) continue

    const lower = sheetName.toLowerCase()
    const looksLikeHistory =
      /historia|ohjelma|aikataulu|esitelm|luento|schedule|past|vuosi|202\d/.test(
        lower,
      ) ||
      rows.some((r) =>
        Object.keys(r).some((k) =>
          /päivä|pvm|date|aika|teema|puhuja|aihe/i.test(k),
        ),
      )

    for (const row of rows) {
      const date = pick(row, [
        'päivämäärä',
        'päivä',
        'pvm',
        'date',
        'aika',
        'sunnuntai',
      ])
      const themeName = pick(row, [
        'teema',
        'aihe',
        'theme',
        'otsikko',
        'esitelmä',
      ])
      const speakerName = pick(row, [
        'puhuja',
        'nimi',
        'name',
        'speaker',
        'esitelmöitsijä',
      ])
      const phone = pick(row, [
        'puhelin',
        'phone',
        'whatsapp',
        'numero',
        'tel',
        'gsm',
      ])
      const last = pick(row, ['viimeksi', 'lastused', 'last_used'])

      // Theme-only row
      if (themeName && !date && !speakerName) {
        const key = themeName.toLowerCase()
        if (!themeSeen.has(key)) {
          themeSeen.add(key)
          themes.push({
            id: uid(),
            number: '',
            name: themeName,
            notes: '',
            disabled: false,
            lastUsedAt: last || null,
          })
        }
        continue
      }

      // Speaker-only row
      if (speakerName && !date && !themeName) {
        const key = speakerName.toLowerCase()
        if (!speakerSeen.has(key)) {
          speakerSeen.add(key)
          speakers.push({
            id: uid(),
            name: speakerName,
            phone,
            congregation: '',
            outlines: [],
            notes: '',
            localOnly: false,
            assistant: false,
            lastUsedAt: last || null,
          snoozeUntil: null,
          unavailable: false,
          unavailableReason: '',
          })
        }
        continue
      }

      // History / schedule row
      if (looksLikeHistory && date && (themeName || speakerName)) {
        history.push({
          date,
          themeName: themeName || 'Tuntematon teema',
          speakerName: speakerName || 'Tuntematon puhuja',
        })
        if (themeName && !themeSeen.has(themeName.toLowerCase())) {
          themeSeen.add(themeName.toLowerCase())
          themes.push({
            id: uid(),
            number: '',
            name: themeName,
            notes: '',
            disabled: false,
            lastUsedAt: date,
          })
        }
        if (speakerName && !speakerSeen.has(speakerName.toLowerCase())) {
          speakerSeen.add(speakerName.toLowerCase())
          speakers.push({
            id: uid(),
            name: speakerName,
            phone,
            congregation: '',
            outlines: [],
            notes: '',
            localOnly: false,
            assistant: false,
            lastUsedAt: date,
          snoozeUntil: null,
          unavailable: false,
          unavailableReason: '',
          })
        }
      }
    }

    notes.push(`Käyty läpi taulukko: ${sheetName} (${rows.length} riviä)`)
  }

  return { themes, speakers, history, sheetNames: wb.SheetNames, notes }
}

export function historyToLectures(
  history: ExcelImportResult['history'],
  themes: Theme[],
  speakers: Speaker[],
): Lecture[] {
  const themeByName = new Map(themes.map((t) => [t.name.toLowerCase(), t]))
  const speakerByName = new Map(speakers.map((s) => [s.name.toLowerCase(), s]))
  const out: Lecture[] = []

  for (const h of history) {
    const theme = themeByName.get(h.themeName.toLowerCase())
    const speaker = speakerByName.get(h.speakerName.toLowerCase())
    if (!theme || !speaker) continue
    out.push({
      id: uid(),
      date: h.date,
      themeId: theme.id,
      speakerId: speaker.id,
      chairpersonId: null,
      readerId: null,
      status: 'done',
      createdAt: new Date().toISOString(),
      notes: 'Tuotu Excelistä',
      eventKind: 'talk',
      customTitle: '',
    })
  }

  return out
}
