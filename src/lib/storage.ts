import type { AppData, Settings, Speaker, Theme, RolePerson, Lecture } from '../types'
import {
  isValidCongregationName,
  sanitizeCongregation,
} from './congregations'
import { applyRetiredOutlineFlags } from './retiredOutlines'

const STORAGE_KEY = 'vuoro-data-v2'

export const DEFAULT_TEMPLATE = `Hei {{nimi}}!

Olisitko käytettävissä pitämään Vääksyssä esitelmän nr. {{numero}} {{teema}} {{päivä}}?

Ilmoitathan, sopiiko ajankohta sinulle. Kiitos!`

/** Older / broken invite templates → migrate to current wording. */
const LEGACY_TEMPLATES = [
  `Hei {{nimi}}!

Olisitko käytettävissä pitämään esitelmän nro {{numero}} "{{teema}}" sunnuntaina {{päivä}}?

Ilmoitathan, sopiiko ajankohta sinulle. Kiitos!`,
  `Hei {{nimi}}!

Olisitko käytettävissä pitämään esitelmän "{{teema}}" sunnuntaina {{päivä}}?

Ilmoitathan, sopiiko ajankohta sinulle. Kiitos!`,
]

export function repairMessageTemplate(template: string): string {
  const t = template?.trim() ?? ''
  if (!t) return DEFAULT_TEMPLATE
  if (t === DEFAULT_TEMPLATE) return DEFAULT_TEMPLATE
  if (LEGACY_TEMPLATES.some((legacy) => legacy === template)) {
    return DEFAULT_TEMPLATE
  }
  // Intermediate / hand-edited invite lines that still break the message
  const looksLikeInvite = /Olisitko käytettävissä pitämään/.test(t)
  if (!looksLikeInvite) return template
  const broken =
    /["“”]\{\{teema\}\}["“”]/.test(t) ||
    /\bnro\s+\{\{numero\}\}/.test(t) ||
    /sunnuntaina\s+\{\{päivä\}\}/.test(t) ||
    /klo\s*11[.,]00/.test(t) ||
    !/\{\{numero\}\}/.test(t) ||
    !/nr\.\s*\{\{numero\}\}/.test(t)
  return broken ? DEFAULT_TEMPLATE : template
}

export const defaultSettings = (): Settings => ({
  messageTemplate: DEFAULT_TEMPLATE,
  eventName: 'viikkuesitelmä',
  recommendSpecialOutlines: false,
  includeLocalOnly: false,
  includeAssistants: false,
  allowedCongregations: [],
  themeSkipCooldown: [],
  speakerSkipCooldown: [],
})

function normalizeTheme(raw: Partial<Theme> & { name: string }): Theme {
  return applyRetiredOutlineFlags({
    id: raw.id ?? crypto.randomUUID(),
    number: raw.number ?? '',
    name: raw.name,
    notes: raw.notes ?? '',
    disabled: Boolean(raw.disabled),
    lastUsedAt: raw.lastUsedAt ?? null,
  })
}

/**
 * Congregations from the official Vääksy sample PDF for visitors
 * who were imported without a seurakunta field.
 * Only fills empty values — never overwrites user edits.
 */
const KNOWN_SPEAKER_CONGREGATIONS: Record<string, string> = {
  'erno lehtimäki': 'Pälkäne',
  'ari-pekka virtanen': 'Pälkäne',
  'joakim narsakka': 'Kärkölä',
  'teppo takanen': 'Vääksy',
  'mikael sutinen': 'Lohja-Eteläinen',
}

function normalizeSpeaker(raw: Partial<Speaker> & { name: string }): Speaker {
  const existing = sanitizeCongregation(raw.congregation ?? '')
  const known =
    KNOWN_SPEAKER_CONGREGATIONS[raw.name.trim().toLowerCase()] ?? ''
  const snooze =
    typeof raw.snoozeUntil === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.snoozeUntil)
      ? raw.snoozeUntil
      : null
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name,
    phone: raw.phone ?? '',
    congregation: existing || known,
    outlines: Array.isArray(raw.outlines) ? raw.outlines.map(String) : [],
    notes: raw.notes ?? '',
    localOnly: Boolean(raw.localOnly),
    assistant: Boolean(raw.assistant),
    lastUsedAt: raw.lastUsedAt ?? null,
    snoozeUntil: snooze,
    unavailable: Boolean(raw.unavailable),
    unavailableReason:
      typeof raw.unavailableReason === 'string' ? raw.unavailableReason : '',
  }
}

function normalizeRolePerson(
  raw: Partial<RolePerson> & { name: string },
): RolePerson {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name,
    phone: raw.phone ?? '',
    notes: raw.notes ?? '',
    lastUsedAt: raw.lastUsedAt ?? null,
    // Default true: most chairpersons also read (legacy data without the field)
    alsoReads: raw.alsoReads !== false,
  }
}

function normalizeLecture(raw: Partial<Lecture> & { id: string }): Lecture {
  const notes = raw.notes ?? ''
  let eventKind = raw.eventKind
  if (
    eventKind !== 'talk' &&
    eventKind !== 'circuit_convention' &&
    eventKind !== 'regional_convention' &&
    eventKind !== 'circuit_week' &&
    eventKind !== 'memorial'
  ) {
    eventKind = /kierrosviikko/i.test(notes)
      ? 'circuit_week'
      : /muistojuhla/i.test(notes)
        ? 'memorial'
        : /aluekonventti/i.test(notes)
          ? 'regional_convention'
          : /kierroskonventti/i.test(notes)
            ? 'circuit_convention'
            : 'talk'
  }
  return {
    id: raw.id,
    date: raw.date ?? todayISO(),
    themeId: raw.themeId ?? '',
    speakerId: raw.speakerId ?? '',
    chairpersonId: raw.chairpersonId ?? null,
    readerId: raw.readerId ?? null,
    status: (raw.status as Lecture['status']) ?? 'planned',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    notes,
    eventKind,
    customTitle:
      typeof raw.customTitle === 'string' ? raw.customTitle : '',
  }
}

export const emptyData = (): AppData => ({
  themes: [],
  speakers: [],
  chairpersons: [],
  readers: [],
  lectures: [],
  settings: defaultSettings(),
})

export function loadData(): AppData {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('vuoro-data-v1')
    if (!raw) return emptyData()
    const parsed = JSON.parse(raw) as Partial<AppData>
    return {
      themes: (parsed.themes ?? []).map((t) => normalizeTheme(t)),
      speakers: (parsed.speakers ?? []).map((s) => normalizeSpeaker(s)),
      chairpersons: (parsed.chairpersons ?? []).map((p) =>
        normalizeRolePerson(p),
      ),
      readers: (parsed.readers ?? []).map((p) => normalizeRolePerson(p)),
      lectures: (parsed.lectures ?? []).map((l) =>
        normalizeLecture(l as Lecture),
      ),
      settings: normalizeSettings(parsed.settings),
    }
  } catch {
    return emptyData()
  }
}

function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...defaultSettings(), ...raw }
  merged.messageTemplate = repairMessageTemplate(merged.messageTemplate)
  merged.allowedCongregations = (merged.allowedCongregations ?? []).filter(
    isValidCongregationName,
  )
  merged.themeSkipCooldown = Array.isArray(raw?.themeSkipCooldown)
    ? raw.themeSkipCooldown.filter((id): id is string => typeof id === 'string')
    : []
  merged.speakerSkipCooldown = Array.isArray(raw?.speakerSkipCooldown)
    ? raw.speakerSkipCooldown.filter((id): id is string => typeof id === 'string')
    : []
  return merged
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Add calendar months to an ISO date (YYYY-MM-DD). */
export function addMonthsISO(iso: string, months: number): string {
  const d = new Date(iso + 'T12:00:00')
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function uid(): string {
  return crypto.randomUUID()
}

export function formatDateFi(iso: string | null): string {
  if (!iso) return 'ei koskaan'
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
  return d.toLocaleDateString('fi-FI', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  })
}

export function daysSince(iso: string | null, from = new Date()): number | null {
  if (!iso) return null
  const then = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''))
  const ms = from.getTime() - then.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

export function formatDaysSince(days: number | null): string {
  if (days === null) return 'ei vielä käytetty'
  if (days < 0) return 'tulevassa varauksessa'
  if (days === 0) return 'tänään'
  if (days === 1) return '1 päivä sitten'
  if (days < 30) return `${days} päivää sitten`
  const weeks = Math.floor(days / 7)
  if (days < 90) return `${weeks} vk sitten`
  const months = Math.floor(days / 30)
  return `${months} kk sitten`
}

export function themeLabel(theme: Theme): string {
  return theme.number ? `${theme.number} — ${theme.name}` : theme.name
}
