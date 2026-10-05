import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { Speaker, Theme } from '../types'
import { applyRetiredOutlineFlags, isRetiredOutline } from './retiredOutlines'
import { uid } from './storage'

let workerReady = false

function ensurePdfWorker() {
  if (workerReady) return
  // Vite resolves worker asset URL at build time
  GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()
  workerReady = true
}

export async function extractPdfText(file: File): Promise<string> {
  ensurePdfWorker()
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({ data }).promise
  const parts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const lineMap = new Map<number, string[]>()
    for (const item of content.items) {
      if (!('str' in item)) continue
      const y = Math.round((item.transform?.[5] ?? 0) * 10) / 10
      const arr = lineMap.get(y) ?? []
      arr.push(item.str)
      lineMap.set(y, arr)
    }
    const lines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, words]) => words.join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    parts.push(lines.join('\n'))
  }
  return parts.join('\n')
}

const PHONE = /(\d{2,4}-\d{2,4}(?:\s?\d{2,5})?)/
const DISABLED = new Set(['47', '82', '112', '123', '131'])

function nameFromList(raw: string): string {
  const cleaned = raw.trim().replace(/,+$/, '')
  if (cleaned.includes(',')) {
    const [last, first] = cleaned.split(',', 2).map((x) => x.trim())
    return `${first} ${last}`.trim()
  }
  const parts = cleaned.split(/\s+/)
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`
  return cleaned
}

export function detectPdfKind(
  text: string,
): 'themes' | 'speakers' | 'unknown' {
  if (/JÄSENNYSTEN PUHUJAT/i.test(text)) return 'themes'
  if (/Jäsennykset/i.test(text) && /Puh\.nro|ESITELMÄT/i.test(text)) {
    return 'speakers'
  }
  if (/^\s*\d+\s+\S+/m.test(text) && /S-31/i.test(text)) return 'themes'
  return 'unknown'
}

export function parseThemesPdfText(text: string): Theme[] {
  const themes: Theme[] = []
  let current: Theme | null = null
  const skip = /^(KIERROS|Esitelmät|Huom\.|Listan|tarkistetut|Siksi)/

  for (const raw of text.split(/\n/)) {
    const line = raw.trim()
    if (!line || skip.test(line)) continue
    const m = line.match(/^((?:S-)?\d+(?:-\d+)?)\s+(.+)$/)
    if (m) {
      const number = m[1]
      const name = m[2].trim()
      if (/^\d{2,3}-\d/.test(name)) continue
      current = applyRetiredOutlineFlags({
        id: uid(),
        number,
        name,
        notes: '',
        disabled:
          DISABLED.has(number) ||
          isRetiredOutline(number) ||
          /ei käytössä|kierrosvalvoj/i.test(name),
        lastUsedAt: null,
      })
      themes.push(current)
      continue
    }
    if (!current) continue
    if (/Kierrosvalvojan|Ei käytössä/i.test(line)) {
      current.disabled = true
      current.name = `${current.name} (${line})`
    }
  }
  return themes
}

export function parseSpeakersPdfText(text: string): Speaker[] {
  const speakers: Speaker[] = []
  let congregation = ''
  const headerRe = /^([A-ZÅÄÖ0-9][A-ZÅÄÖ0-9\- ]+)$/

  for (const raw of text.split(/\n/)) {
    let line = raw.trim()
    if (!line) continue
    if (
      /^(KIERROS|Lä =|Ap =|Nimi |Yhteysveli|Huom\.|Listan)/.test(line)
    ) {
      continue
    }
    if (headerRe.test(line) && !/\d/.test(line) && line.length > 2) {
      congregation = line
        .split('-')
        .map((p) => p.charAt(0) + p.slice(1).toLowerCase())
        .join('-')
      continue
    }

    let role: 'Ap' | 'Lä' | null = null
    const roleMatch = line.match(/^(Ap|Lä)\s+(.*)$/)
    if (roleMatch) {
      role = roleMatch[1] as 'Ap' | 'Lä'
      line = roleMatch[2]
    }

    const pm = line.match(PHONE)
    if (!pm || pm.index == null) continue
    const before = line.slice(0, pm.index).trim().replace(/,+$/, '')
    const after = line.slice(pm.index + pm[0].length).trim()
    if (!before || before.length < 3) continue

    const outlines: string[] = []
    const seen = new Set<string>()
    for (const tok of after.match(/S-\d+(?:-\d+)?|\b\d{1,3}\b/g) ?? []) {
      let o = tok
      if (!tok.startsWith('S-')) {
        const n = Number(tok)
        if (n < 1 || n > 200) continue
        o = String(n)
      }
      if (!seen.has(o)) {
        seen.add(o)
        outlines.push(o)
      }
    }

    const notes: string[] = []
    if (role === 'Ap') notes.push('Avustava palvelija')
    if (role === 'Lä') notes.push('Vain lähiseurakuntiin')
    if (/eng/i.test(after)) notes.push('myös englanti')
    if (/ruots/i.test(after)) notes.push('myös ruotsi')
    if (/venä/i.test(after)) notes.push('myös venäjä')

    speakers.push({
      id: uid(),
      name: nameFromList(before),
      phone: pm[0].replace(/\s+/g, ' '),
      congregation,
      outlines,
      notes: notes.join(', '),
      localOnly: role === 'Lä',
      assistant: role === 'Ap',
      lastUsedAt: null,
    snoozeUntil: null,
    unavailable: false,
    unavailableReason: '',
    })
  }

  const byKey = new Map<string, Speaker>()
  for (const s of speakers) {
    const key = `${s.name.toLowerCase()}|${s.phone.replace(/\D/g, '')}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, s)
      continue
    }
    prev.outlines = [...new Set([...prev.outlines, ...s.outlines])]
    if (s.notes && !prev.notes.includes(s.notes)) {
      prev.notes = [prev.notes, s.notes].filter(Boolean).join(', ')
    }
  }

  return [...byKey.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'fi'),
  )
}

export type PdfImportBundle = {
  themes: Theme[]
  speakers: Speaker[]
  files: Array<{ name: string; kind: string; count: number }>
}

export async function parseKierrosPdfFiles(
  files: File[],
): Promise<PdfImportBundle> {
  const themes: Theme[] = []
  const speakers: Speaker[] = []
  const meta: PdfImportBundle['files'] = []

  for (const file of files) {
    const text = await extractPdfText(file)
    const kind = detectPdfKind(text)
    if (kind === 'themes') {
      const parsed = parseThemesPdfText(text)
      themes.push(...parsed)
      meta.push({ name: file.name, kind: 'jäsennykset', count: parsed.length })
    } else if (kind === 'speakers') {
      const parsed = parseSpeakersPdfText(text)
      speakers.push(...parsed)
      meta.push({ name: file.name, kind: 'puhujat', count: parsed.length })
    } else {
      // try both heuristics
      const t = parseThemesPdfText(text)
      const s = parseSpeakersPdfText(text)
      if (t.length > s.length) {
        themes.push(...t)
        meta.push({ name: file.name, kind: 'jäsennykset?', count: t.length })
      } else if (s.length) {
        speakers.push(...s)
        meta.push({ name: file.name, kind: 'puhujat?', count: s.length })
      } else {
        meta.push({ name: file.name, kind: 'tuntematon', count: 0 })
      }
    }
  }

  return { themes, speakers, files: meta }
}
