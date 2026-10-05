import Papa from 'papaparse'
import type { Speaker, Theme } from '../types'
import { applyRetiredOutlineFlags } from './retiredOutlines'
import { uid } from './storage'

function pick(row: Record<string, string>, keys: string[]): string {
  const lower = Object.fromEntries(
    Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v?.trim() ?? '']),
  )
  for (const key of keys) {
    const val = lower[key.toLowerCase()]
    if (val) return val
  }
  return ''
}

function parseOutlines(raw: string): string[] {
  return [...raw.matchAll(/S-\d+(?:-\d+)?|\b\d{1,3}\b/g)].map((m) => m[0])
}

export function parseThemesCsv(text: string): Theme[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (!result.meta.fields?.length) {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^teema$/i.test(l))
      .map((name) =>
        applyRetiredOutlineFlags({
          id: uid(),
          number: '',
          name,
          notes: '',
          disabled: false,
          lastUsedAt: null,
        }),
      )
  }

  return result.data
    .map((row): Theme | null => {
      const name = pick(row, ['teema', 'theme', 'nimi', 'name', 'otsikko'])
      if (!name) return null
      const last = pick(row, [
        'viimeksi',
        'lastused',
        'last_used',
        'lastusedat',
        'päivämäärä',
        'pvm',
      ])
      const disabledRaw = pick(row, ['ei_kaytossa', 'disabled', 'ei käytössä'])
      return applyRetiredOutlineFlags({
        id: uid(),
        number: pick(row, ['numero', 'number', 'nro', 'jäsennys']),
        name,
        notes: pick(row, ['muistiinpanot', 'notes', 'kommentti']),
        disabled: ['1', 'true', 'kyllä', 'yes', 'x'].includes(
          disabledRaw.toLowerCase(),
        ),
        lastUsedAt: last || null,
      })
    })
    .filter((t): t is Theme => t !== null)
}

export function parseSpeakersCsv(text: string): Speaker[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  })

  if (!result.meta.fields?.length) {
    return text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !/^nimi$/i.test(l))
      .map((line): Speaker => {
        const parts = line.split(/[;\t]/).map((p) => p.trim())
        return {
          id: uid(),
          name: parts[0] ?? line,
          phone: parts[1] ?? '',
          congregation: '',
          outlines: [],
          notes: parts.slice(2).join(', '),
          localOnly: false,
          assistant: false,
          lastUsedAt: null,
          snoozeUntil: null,
          unavailable: false,
          unavailableReason: '',
        }
      })
  }

  return result.data
    .map((row): Speaker | null => {
      const name = pick(row, ['nimi', 'name', 'puhuja', 'speaker'])
      if (!name) return null
      const last = pick(row, [
        'viimeksi',
        'lastused',
        'last_used',
        'lastusedat',
        'päivämäärä',
        'pvm',
      ])
      const notes = pick(row, ['muistiinpanot', 'notes', 'kommentti'])
      return {
        id: uid(),
        name,
        phone: pick(row, ['puhelin', 'phone', 'whatsapp', 'tel', 'gsm']),
        congregation: pick(row, ['seurakunta', 'congregation', 'sk']),
        outlines: parseOutlines(
          pick(row, ['jasennykset', 'jäsennykset', 'outlines', 'aiheet']),
        ),
        notes,
        localOnly: /lähiseurakunta|local/i.test(notes),
        assistant: /avustava|\bap\b/i.test(notes),
        lastUsedAt: last || null,
        snoozeUntil: null,
        unavailable: false,
        unavailableReason: '',
      }
    })
    .filter((s): s is Speaker => s !== null)
}

export function themesToCsv(themes: Theme[]): string {
  return Papa.unparse(
    themes.map((t) => ({
      numero: t.number,
      teema: t.name,
      viimeksi: t.lastUsedAt ?? '',
      ei_kaytossa: t.disabled ? '1' : '',
      muistiinpanot: t.notes,
    })),
  )
}

export function speakersToCsv(speakers: Speaker[]): string {
  return Papa.unparse(
    speakers.map((s) => ({
      nimi: s.name,
      puhelin: s.phone,
      seurakunta: s.congregation,
      jasennykset: s.outlines.join(' '),
      viimeksi: s.lastUsedAt ?? '',
      muistiinpanot: s.notes,
    })),
  )
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
