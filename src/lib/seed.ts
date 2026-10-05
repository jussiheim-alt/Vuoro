import type { AppData, Lecture, LectureStatus, Speaker, Theme } from '../types'
import { applyRetiredOutlineFlags } from './retiredOutlines'
import { todayISO, uid } from './storage'

export type KierrosSeed = {
  sourceDate: string
  kierros: string
  themes: Array<{
    number: string
    name: string
    disabled?: boolean
    lastUsedAt?: string | null
  }>
  speakers: Array<{
    name: string
    phone: string
    congregation?: string
    outlines?: string[]
    notes?: string
    localOnly?: boolean
    assistant?: boolean
    lastUsedAt?: string | null
  }>
  history?: Array<{
    date: string
    outline: string
    speakerName: string | null
    rawName?: string
    status?: LectureStatus | string
    notes?: string
  }>
  historyStats?: Record<string, unknown>
}

export async function fetchKierrosSeed(): Promise<KierrosSeed> {
  const res = await fetch(`/kierros6-seed.json?t=${Date.now()}`)
  if (!res.ok) throw new Error('Seed-tiedostoa ei löytynyt')
  return res.json() as Promise<KierrosSeed>
}

export function seedToAppLists(seed: KierrosSeed): {
  themes: Theme[]
  speakers: Speaker[]
} {
  const themes: Theme[] = seed.themes.map((t) =>
    applyRetiredOutlineFlags({
      id: uid(),
      number: String(t.number),
      name: t.name,
      notes: '',
      disabled: Boolean(t.disabled),
      lastUsedAt: t.lastUsedAt ?? null,
    }),
  )

  // Ensure placeholder theme exists for bookings without outline
  if (!themes.some((t) => t.number === '—')) {
    themes.push({
      id: uid(),
      number: '—',
      name: 'Jäsennys ei tiedossa (varauslista)',
      notes: '',
      disabled: true,
      lastUsedAt: null,
    })
  }

  const speakers: Speaker[] = seed.speakers.map((s) => ({
    id: uid(),
    name: s.name,
    phone: s.phone,
    congregation: s.congregation ?? '',
    outlines: (s.outlines ?? []).map(String),
    notes: s.notes ?? '',
    localOnly: Boolean(s.localOnly),
    assistant: Boolean(s.assistant),
    lastUsedAt: s.lastUsedAt ?? null,
  snoozeUntil: null,
  unavailable: false,
  unavailableReason: '',
  }))

  return { themes, speakers }
}

function resolveStatus(
  date: string,
  explicit?: string,
): LectureStatus {
  if (
    explicit === 'planned' ||
    explicit === 'confirmed' ||
    explicit === 'done' ||
    explicit === 'declined' ||
    explicit === 'deferred'
  ) {
    return explicit
  }
  return date >= todayISO() ? 'confirmed' : 'done'
}

function historyToLectures(
  seed: KierrosSeed,
  themes: Theme[],
  speakers: Speaker[],
): Lecture[] {
  if (!seed.history?.length) return []
  const themeByNum = new Map(themes.map((t) => [t.number, t]))
  const unknownTheme = themes.find((t) => t.number === '—')
  const speakerByName = new Map(
    speakers.map((s) => [s.name.toLowerCase(), s]),
  )

  const out: Lecture[] = []
  for (const h of seed.history) {
    if (!h.speakerName) continue
    const speaker = speakerByName.get(h.speakerName.toLowerCase())
    if (!speaker) continue

    const theme =
      (h.outline ? themeByNum.get(String(h.outline)) : undefined) ??
      unknownTheme
    if (!theme) continue

    out.push({
      id: uid(),
      date: h.date,
      themeId: theme.id,
      speakerId: speaker.id,
      chairpersonId: null,
      readerId: null,
      status: resolveStatus(h.date, h.status),
      createdAt: new Date().toISOString(),
      notes: h.notes || 'Tuotu varauslistasta',
      eventKind: 'talk',
      customTitle: '',
    })
  }
  return out
}

function isImportedNote(notes: string): boolean {
  return (
    notes === 'Tuotu varauslistasta' ||
    notes.startsWith('Tuotu varauslistasta:')
  )
}

/** Replace lists from seed; keep manual lectures only if ids still match after merge. */
export function applySeedToData(data: AppData, seed: KierrosSeed): AppData {
  const { themes, speakers } = seedToAppLists(seed)
  const imported = historyToLectures(seed, themes, speakers)

  const importedKeys = new Set(
    imported.map((l) => `${l.date}|${l.themeId}|${l.speakerId}`),
  )

  const themeIdByOld = new Map<string, string>()
  const speakerIdByOld = new Map<string, string>()
  const newThemeByNum = new Map(themes.map((t) => [t.number, t.id]))
  const newSpeakerByPhone = new Map(
    speakers.map((s) => [s.phone.replace(/\D/g, ''), s.id]),
  )
  const newSpeakerByName = new Map(
    speakers.map((s) => [s.name.toLowerCase(), s.id]),
  )

  for (const t of data.themes) {
    const nid = newThemeByNum.get(t.number)
    if (nid) themeIdByOld.set(t.id, nid)
  }
  for (const s of data.speakers) {
    const nid =
      newSpeakerByPhone.get(s.phone.replace(/\D/g, '')) ??
      newSpeakerByName.get(s.name.toLowerCase())
    if (nid) speakerIdByOld.set(s.id, nid)
  }

  const keptManual: Lecture[] = []
  for (const l of data.lectures) {
    if (isImportedNote(l.notes)) continue
    const themeId = themeIdByOld.get(l.themeId)
    const speakerId = speakerIdByOld.get(l.speakerId)
    if (!themeId || !speakerId) continue
    const key = `${l.date}|${themeId}|${speakerId}`
    if (importedKeys.has(key)) continue
    keptManual.push({ ...l, themeId, speakerId })
  }

  return {
    ...data,
    themes,
    speakers,
    lectures: [...imported, ...keptManual].sort((a, b) =>
      b.date.localeCompare(a.date),
    ),
  }
}
