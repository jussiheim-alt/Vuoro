import * as XLSX from 'xlsx'
import type { AppData, Lecture, LectureStatus, Speaker, Theme } from '../types'
import { recomputeLastUsed } from './recommend'
import { todayISO, uid } from './storage'

const SKIP_ONLY_RE =
  /^\s*(konventi|kierroskonventti|kenttäpalveluskokous|palveluspuhe|peruuntui|siirretty)\b/i
const KIERROSVIIKKO_RE = /^\s*kierrosviikko\b/i
const PHONE_RE = /\d{2,4}[-\s]?\d{2,4}[-\s]?\d{2,5}/g

function parseFiDate(raw: unknown, defaultYear?: number): string | null {
  if (raw == null || raw === '') return null
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw === 'number' && raw > 30000 && raw < 60000) {
    const epoch = Date.UTC(1899, 11, 30)
    return new Date(epoch + raw * 86400000).toISOString().slice(0, 10)
  }
  const s = String(raw).trim()
  const full = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/)
  if (full) {
    const year = full[3].length === 2 ? `20${full[3]}` : full[3]
    return `${year}-${full[2].padStart(2, '0')}-${full[1].padStart(2, '0')}`
  }
  const short = s.match(/^(\d{1,2})\.(\d{1,2})$/)
  if (short && defaultYear) {
    return `${defaultYear}-${short[2].padStart(2, '0')}-${short[1].padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  return null
}

function extractOutline(text: string): string | null {
  const candidates: string[] = []
  const re = /(?:^|[\s,])(0*\d{1,3}|S-\d+)(?=\s+[A-ZÅÄÖa-zåäö"“”])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const tok = m[1]
    if (tok.startsWith('S-')) candidates.push(tok)
    else {
      const n = Number(tok)
      if (n >= 1 && n <= 200) candidates.push(String(n))
    }
  }
  return candidates.length ? candidates[candidates.length - 1] : null
}

function matchThemeByTitle(text: string, themes: Theme[]): Theme | null {
  const lower = text.toLowerCase().replace(/["""„«»]/g, '')
  let best: Theme | null = null
  let bestScore = 0
  for (const t of themes) {
    const name = t.name
      .toLowerCase()
      .replace(/["""„«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (name.length < 12) continue
    const snippet = name.slice(0, Math.min(48, name.length))
    if (lower.includes(snippet) && name.length > bestScore) {
      best = t
      bestScore = name.length
    }
  }
  return best
}

function extractName(text: string, outline: string | null, theme: Theme | null): string {
  let t = text.replace(
    /^(?:\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*(?:siirtyi|->|—>|–>|>>>|--->>>|,|\.{2,})\s*)+/i,
    '',
  )
  t = t.replace(/\.{2,}/g, ' ')
  // Drop leading Finnish note words until a Name-like token
  t = t.replace(
    /^(?:peruuntui|siirtyi|siirretty|ja|takia|laitoin|soitettu|txt|viesti|että)\b[\s\-\.,>]*/gi,
    '',
  )
  let t2 = t.replace(PHONE_RE, ' ')
  if (outline) {
    const pat = new RegExp(`(?:^|[\\s,])0*${outline}(?=\\s|$)`)
    const idx = t2.search(pat)
    if (idx >= 0) t2 = t2.slice(0, idx)
  }
  if (theme && theme.number !== '—') {
    const idx = t2.toLowerCase().indexOf(theme.name.slice(0, 20).toLowerCase())
    if (idx > 0) t2 = t2.slice(0, idx)
  }
  t2 = t2
    .replace(/\d{1,2}\.\d{1,2}(?:\.\d{2,4})?/g, ' ')
    .replace(/erikoisesitelmä/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;\-\s>]+|[,;\-\s>]+$/g, '')

  // Prefer "First Last" or "Last First" before congregation: look for two capitalized words
  const person = t2.match(
    /([A-ZÅÄÖÁÉÜ][A-Za-zÅÄÖåäöÁÉÜáéü'\-]+(?:\s+[A-ZÅÄÖÁÉÜ][A-Za-zÅÄÖåäöÁÉÜáéü'\-]+)+)/,
  )
  if (person) {
    const chunk = person[1]
    // If "Name Place" without comma, keep first two tokens
    return cleanPerson(chunk.split(/\s+/).slice(0, 2).join(' '))
  }

  if (t2.includes(',')) {
    const before = t2.split(',')[0].trim()
    if (before.split(/\s+/).length >= 2) return cleanPerson(before)
  }
  return cleanPerson(t2.split(/\s+/).filter(Boolean).slice(0, 2).join(' '))
}

function cleanPerson(name: string): string {
  return name.replace(/[^A-Za-zÅÄÖåäöÁÉÜáéü'\-\s]/g, '').replace(/\s+/g, ' ').trim()
}

function tokens(name: string): string[] {
  return name
    .trim()
    .split(/[\s-]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p && p !== 'ap')
}

function titleCaseName(raw: string): string {
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function matchSpeaker(rawName: string, speakers: Speaker[]): Speaker | null {
  const raw = tokens(rawName)
  if (raw.length < 2) return null
  const rawSet = new Set(raw)
  let best: Speaker | null = null
  let bestScore = 0
  for (const s of speakers) {
    const st = tokens(s.name)
    if (st.length < 2) continue
    let score = [...rawSet].filter((x) => st.includes(x)).length
    if (
      (raw[0] === st[0] && raw[raw.length - 1] === st[st.length - 1]) ||
      (raw[0] === st[st.length - 1] && raw[raw.length - 1] === st[0])
    ) {
      score += 2
    }
    if (score > bestScore) {
      bestScore = score
      best = s
    }
  }
  return bestScore >= 2 ? best : null
}

function extractPhone(text: string): string {
  const m = text.match(PHONE_RE)
  return m ? m[0].replace(/\s+/g, ' ') : ''
}

function extractCongregation(text: string, name: string): string {
  const t = text.replace(PHONE_RE, ' ')
  const nameRe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const afterName = t.split(new RegExp(nameRe, 'i'))[1] ?? ''
  const m = afterName.match(
    /^\s*,\s*([A-ZÅÄÖa-zåäö][A-Za-zÅÄÖåäö\- ]{2,40}?)(?=\s+\d|\s+[A-ZÅÄÖ"“]|$)/,
  )
  return m ? m[1].trim() : ''
}

export type VarausImportResult = {
  lectures: Lecture[]
  guestSpeakers: Speaker[]
  extraThemes: Theme[]
  matched: number
  scanned: number
  futureBooked: number
  unmatchedNames: string[]
}

export function parseVarauslistaBuffer(
  buffer: ArrayBuffer,
  themes: Theme[],
  speakers: Speaker[],
): VarausImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const themeByNum = new Map(themes.map((t) => [t.number, t]))
  const lectures: Lecture[] = []
  const guestSpeakers: Speaker[] = []
  const guestsByKey = new Map<string, Speaker>()
  const extraThemes: Theme[] = []
  const unmatched = new Map<string, number>()
  let scanned = 0
  const today = todayISO()

  const unknownTheme: Theme = {
    id: uid(),
    number: '—',
    name: 'Jäsennys ei tiedossa (varauslista)',
    notes: '',
    disabled: true,
    lastUsedAt: null,
  }
  let unknownUsed = false

  for (const sheetName of wb.SheetNames) {
    if (!/^20\d{2}$/.test(sheetName)) continue
    const sheetYear = Number(sheetName)
    const sheet = wb.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(
      sheet,
      { header: 1, defval: null, raw: true },
    )

    for (const row of rows) {
      if (!row?.length) continue
      const date = parseFiDate(row[0], sheetYear)
      const text = row[1] == null ? '' : String(row[1]).trim()
      if (!date || !text || text.toUpperCase().startsWith('ESITELMIEN')) continue
      if (SKIP_ONLY_RE.test(text)) continue

      // Circuit week: reserved slot, speaker/theme filled in later
      if (KIERROSVIIKKO_RE.test(text)) {
        scanned += 1
        let placeholderSpeaker = speakers.find(
          (s) => s.name.toLowerCase() === 'kierrosviikko',
        )
        if (!placeholderSpeaker) {
          const key = 'kierrosviikko'
          let guest = guestsByKey.get(key)
          if (!guest) {
            guest = {
              id: uid(),
              name: 'Kierrosviikko',
              phone: '',
              congregation: '',
              outlines: [],
              notes: 'Paikka varattu — lisää puhuja myöhemmin',
              localOnly: false,
              assistant: false,
              lastUsedAt: null,
            snoozeUntil: null,
            unavailable: false,
            unavailableReason: '',
            }
            guestsByKey.set(key, guest)
            guestSpeakers.push(guest)
          }
          placeholderSpeaker = guest
        }
        lectures.push({
          id: uid(),
          date,
          themeId: '',
          speakerId: '',
          chairpersonId: null,
          readerId: null,
          status: date >= today ? 'confirmed' : 'done',
          createdAt: new Date().toISOString(),
          notes: 'Tuotu varauslistasta: Kierrosviikko',
          eventKind: 'circuit_week',
          customTitle: '',
        })
        unknownUsed = true
        continue
      }

      const outline = extractOutline(text)
      if (outline && ['47', '82', '112', '123', '131'].includes(outline)) continue

      let theme = outline ? themeByNum.get(outline) : undefined
      if (!theme) {
        const byTitle = matchThemeByTitle(text, themes)
        if (byTitle) theme = byTitle
      }

      if (!theme) {
        const maybeName = extractName(text, outline, null)
        if (tokens(maybeName).length < 2 && !/erikoisesitelmä/i.test(text)) {
          continue
        }
        theme = unknownTheme
        unknownUsed = true
      }

      scanned += 1
      const rawName = extractName(text, outline, theme)
      if (tokens(rawName).length < 2) {
        // erikoisesitelmä with known local speaker pattern "Timo Michelsson, Erikoisesitelmä"
        if (/erikoisesitelmä/i.test(text)) {
          const parts = text.split(',')[0]?.trim() ?? ''
          if (tokens(parts).length >= 2) {
            // fall through with parts as name
          } else {
            unmatched.set(text.slice(0, 50), (unmatched.get(text.slice(0, 50)) ?? 0) + 1)
            continue
          }
        } else {
          unmatched.set(rawName || text.slice(0, 40), (unmatched.get(rawName || text.slice(0, 40)) ?? 0) + 1)
          continue
        }
      }

      const nameForMatch =
        tokens(rawName).length >= 2
          ? rawName
          : (text.split(',')[0]?.trim() ?? rawName)

      let speaker = matchSpeaker(nameForMatch, speakers)
      if (!speaker) {
        const key = tokens(nameForMatch).sort().join(' ')
        let guest = guestsByKey.get(key)
        if (!guest) {
          guest = {
            id: uid(),
            name: titleCaseName(nameForMatch),
            phone: extractPhone(text),
            congregation: extractCongregation(text, nameForMatch),
            outlines: outline ? [outline] : [],
            notes: 'Vierailija (varauslista)',
            localOnly: false,
            assistant: false,
            lastUsedAt: null,
          snoozeUntil: null,
          unavailable: false,
          unavailableReason: '',
          }
          guestsByKey.set(key, guest)
          guestSpeakers.push(guest)
        }
        speaker = guest
      }

      const status: LectureStatus = date >= today ? 'confirmed' : 'done'
      lectures.push({
        id: uid(),
        date,
        themeId: theme.id,
        speakerId: speaker.id,
        chairpersonId: null,
        readerId: null,
        status,
        createdAt: new Date().toISOString(),
        notes:
          theme.id === unknownTheme.id
            ? `Tuotu varauslistasta: ${text.slice(0, 140)}`
            : 'Tuotu varauslistasta',
        eventKind: 'talk',
        customTitle: '',
      })
    }
  }

  if (unknownUsed) extraThemes.push(unknownTheme)

  return {
    lectures,
    guestSpeakers,
    extraThemes,
    matched: lectures.length,
    scanned,
    futureBooked: lectures.filter((l) => l.status === 'confirmed').length,
    unmatchedNames: [...unmatched.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30)
      .map(([n]) => n),
  }
}

export function applyVarauslistaToData(
  data: AppData,
  parsed: VarausImportResult,
): AppData {
  const kept = data.lectures.filter(
    (l) =>
      l.notes !== 'Tuotu varauslistasta' &&
      !l.notes.startsWith('Tuotu varauslistasta:'),
  )

  const themes = [...data.themes]
  for (const t of parsed.extraThemes) {
    if (!themes.some((x) => x.number === t.number && x.name === t.name)) {
      themes.push(t)
    }
  }
  // Ensure unknown theme exists if lectures need it
  for (const l of parsed.lectures) {
    if (!themes.some((t) => t.id === l.themeId)) {
      const extra = parsed.extraThemes.find((t) => t.id === l.themeId)
      if (extra && !themes.some((t) => t.id === extra.id)) themes.push(extra)
    }
  }

  const speakers = [...data.speakers]
  const byPhone = new Map(
    speakers.filter((s) => s.phone).map((s) => [s.phone.replace(/\D/g, ''), s]),
  )
  const byName = new Map(speakers.map((s) => [s.name.toLowerCase(), s]))
  const speakerIdMap = new Map<string, string>()

  for (const s of speakers) speakerIdMap.set(s.id, s.id)

  for (const g of parsed.guestSpeakers) {
    const prev =
      (g.phone ? byPhone.get(g.phone.replace(/\D/g, '')) : undefined) ??
      byName.get(g.name.toLowerCase())
    if (prev) {
      speakerIdMap.set(g.id, prev.id)
    } else {
      speakers.push(g)
      byName.set(g.name.toLowerCase(), g)
      if (g.phone) byPhone.set(g.phone.replace(/\D/g, ''), g)
      speakerIdMap.set(g.id, g.id)
    }
  }

  const lectures: Lecture[] = parsed.lectures.map((l) => ({
    ...l,
    speakerId: speakerIdMap.get(l.speakerId) ?? l.speakerId,
  }))

  const importedKeys = new Set(
    lectures.map((l) => `${l.date}|${l.themeId}|${l.speakerId}`),
  )
  const manual = kept.filter(
    (l) => !importedKeys.has(`${l.date}|${l.themeId}|${l.speakerId}`),
  )

  return recomputeLastUsed({
    ...data,
    themes,
    speakers,
    lectures: [...lectures, ...manual].sort((a, b) =>
      b.date.localeCompare(a.date),
    ),
  })
}
