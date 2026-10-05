import type {
  AppData,
  LectureEventKind,
  Recommendation,
  RolePerson,
  Speaker,
  Theme,
} from '../types'
import { congregationFilterOptions } from './congregations'
import { daysSince, uid } from './storage'
import {
  themeMatchesCategory,
  type ThemeCategoryId,
} from './themeCategories'

/** Do not recommend the same speaker within this many months of another turn. */
export const SPEAKER_COOLDOWN_MONTHS = 10

export type RecommendMode = 'longest' | 'topic' | 'congregation'

function byOldestUsed<T extends { id: string; lastUsedAt: string | null; name: string }>(
  items: T[],
  excludeIds: Set<string> = new Set(),
): T[] {
  return [...items]
    .filter((item) => !excludeIds.has(item.id))
    .sort((a, b) => {
      if (a.lastUsedAt === null && b.lastUsedAt === null) {
        return a.name.localeCompare(b.name, 'fi')
      }
      if (a.lastUsedAt === null) return -1
      if (b.lastUsedAt === null) return 1
      if (a.lastUsedAt === b.lastUsedAt) {
        return a.name.localeCompare(b.name, 'fi')
      }
      return a.lastUsedAt.localeCompare(b.lastUsedAt)
    })
}

export function rankThemes(themes: Theme[]): Theme[] {
  return byOldestUsed(themes.filter((t) => !t.disabled))
}

export function rankSpeakers(speakers: Speaker[]): Speaker[] {
  return byOldestUsed(speakers)
}

/**
 * Speakers imported only from booking history (varauslista) often lack
 * congregation. Circuit PDF speakers always have one — prefer those.
 */
export function isHistoryOnlyVisitor(speaker: Speaker): boolean {
  const notes = (speaker.notes || '').toLowerCase()
  if (notes.includes('varauslista')) return true
  return !speaker.congregation.trim()
}

export function speakerCanGive(speaker: Speaker, theme: Theme): boolean {
  if (!theme.number) return true
  return speaker.outlines.includes(theme.number)
}

/** Whole calendar months between two ISO dates (absolute). */
export function monthsBetweenISO(a: string, b: string): number {
  const da = new Date(a + 'T12:00:00')
  const db = new Date(b + 'T12:00:00')
  return Math.abs(
    (db.getFullYear() - da.getFullYear()) * 12 +
      (db.getMonth() - da.getMonth()),
  )
}

/**
 * True if the speaker already has a turn (past or future) within
 * `withinMonths` of `aroundDate`. Declined/deferred do not count.
 */
export function speakerHasAssignmentWithinMonths(
  data: AppData,
  speakerId: string,
  aroundDate: string,
  withinMonths = SPEAKER_COOLDOWN_MONTHS,
): boolean {
  for (const lec of data.lectures) {
    if (lec.speakerId !== speakerId) continue
    if (lec.status === 'declined' || lec.status === 'deferred') continue
    if (!lec.date) continue
    if (monthsBetweenISO(lec.date, aroundDate) < withinMonths) return true
  }
  const speaker = data.speakers.find((s) => s.id === speakerId)
  if (
    speaker?.lastUsedAt &&
    monthsBetweenISO(speaker.lastUsedAt, aroundDate) < withinMonths
  ) {
    return true
  }
  return false
}

export function passesSpeakerFilters(
  speaker: Speaker,
  settings: AppData['settings'],
  asOf = todayIsoLocal(),
): boolean {
  if (speaker.localOnly && !settings.includeLocalOnly) return false
  if (speaker.assistant && !settings.includeAssistants) return false
  if (
    settings.allowedCongregations.length > 0 &&
    !settings.allowedCongregations.includes(speaker.congregation)
  ) {
    return false
  }
  if (speaker.snoozeUntil && speaker.snoozeUntil > asOf) return false
  if (speaker.unavailable) return false
  return true
}

function todayIsoLocal(): string {
  return new Date().toISOString().slice(0, 10)
}

export const THEME_SKIP_COOLDOWN_SIZE = 10
export const SPEAKER_SKIP_COOLDOWN_SIZE = 10

/** Push a theme into the skip cooldown ring (keeps last N skipped themes out). */
export function pushThemeSkipCooldown(
  data: AppData,
  themeId: string,
  size = THEME_SKIP_COOLDOWN_SIZE,
): AppData {
  const prev = data.settings.themeSkipCooldown ?? []
  const next = [...prev.filter((id) => id !== themeId), themeId].slice(-size)
  return {
    ...data,
    settings: { ...data.settings, themeSkipCooldown: next },
  }
}

/** Push a speaker into the skip cooldown ring (keeps last N skipped speakers out). */
export function pushSpeakerSkipCooldown(
  data: AppData,
  speakerId: string,
  size = SPEAKER_SKIP_COOLDOWN_SIZE,
): AppData {
  const prev = data.settings.speakerSkipCooldown ?? []
  const next = [...prev.filter((id) => id !== speakerId), speakerId].slice(
    -size,
  )
  return {
    ...data,
    settings: { ...data.settings, speakerSkipCooldown: next },
  }
}

/** Snooze speaker and mark lecture deferred (frees the calendar date). */
export function deferLectureAsk(
  data: AppData,
  lectureId: string,
  months: number,
): AppData {
  const lec = data.lectures.find((l) => l.id === lectureId)
  if (!lec) return data
  const until = (() => {
    const d = new Date()
    d.setMonth(d.getMonth() + Math.max(1, months))
    return d.toISOString().slice(0, 10)
  })()
  return {
    ...data,
    lectures: data.lectures.map((l) =>
      l.id === lectureId
        ? {
            ...l,
            status: 'deferred' as const,
            notes: l.notes
              ? `${l.notes} · Palataan ~${months} kk`
              : `Palataan ~${months} kk`,
          }
        : l,
    ),
    speakers: data.speakers.map((s) =>
      s.id === lec.speakerId ? { ...s, snoozeUntil: until } : s,
    ),
  }
}

export function recommend(
  data: AppData,
  options: {
    skipSpeakerIds?: string[]
    skipThemeIds?: string[]
    /** Sunday being planned — cooldown is measured against this date. */
    lectureDate?: string
    mode?: RecommendMode
    topicCategory?: ThemeCategoryId | null
    congregation?: string | null
  } = {},
): Recommendation | null {
  const skipThemes = new Set(options.skipThemeIds ?? [])
  const skipSpeakers = new Set(options.skipSpeakerIds ?? [])
  const lectureDate = options.lectureDate ?? todayIsoLocal()
  const mode = options.mode ?? 'longest'
  const pending = pendingAskIds(data)
  for (const id of pending.themeIds) skipThemes.add(id)
  for (const id of pending.speakerIds) skipSpeakers.add(id)
  for (const id of data.settings.themeSkipCooldown ?? []) skipThemes.add(id)
  for (const id of data.settings.speakerSkipCooldown ?? []) skipSpeakers.add(id)
  const allowSpecial = data.settings.recommendSpecialOutlines

  const cong =
    mode === 'congregation' ? (options.congregation ?? '').trim() : ''

  const candidateThemes = byOldestUsed(
    data.themes.filter((t) => {
      if (t.disabled) return false
      if (skipThemes.has(t.id)) return false
      if (!allowSpecial && t.number.startsWith('S-')) return false
      if (
        mode === 'topic' &&
        options.topicCategory &&
        !themeMatchesCategory(t, options.topicCategory)
      ) {
        return false
      }
      return true
    }),
  )

  const asOfForDays = new Date(lectureDate + 'T12:00:00')

  for (const theme of candidateThemes) {
    const eligible = eligibleSpeakersForTheme(data, theme, {
      skipSpeakerIds: [...skipSpeakers],
      lectureDate,
    }).filter((s) => {
      if (!cong) return true
      return s.congregation.trim().toLowerCase() === cong.toLowerCase()
    })
    const speaker = eligible[0]
    if (!speaker) continue
    return {
      theme,
      speaker,
      themeDaysSince: daysSince(theme.lastUsedAt, asOfForDays),
      speakerDaysSince: daysSince(speaker.lastUsedAt, asOfForDays),
      eligibleSpeakerCount: eligible.length,
    }
  }

  return null
}

export function eligibleSpeakersForTheme(
  data: AppData,
  theme: Theme,
  options: { skipSpeakerIds?: string[]; lectureDate?: string } = {},
): Speaker[] {
  const skip = new Set(options.skipSpeakerIds ?? [])
  const lectureDate = options.lectureDate ?? todayIsoLocal()
  const eligible = data.speakers.filter((s) => {
    if (skip.has(s.id)) return false
    if (!passesSpeakerFilters(s, data.settings, lectureDate)) return false
    if (
      speakerHasAssignmentWithinMonths(
        data,
        s.id,
        lectureDate,
        SPEAKER_COOLDOWN_MONTHS,
      )
    ) {
      return false
    }
    if (theme.number && s.outlines.length > 0) {
      return speakerCanGive(s, theme)
    }
    return !theme.number
  })

  // Prefer circuit-PDF speakers (known congregation) over history-only visitors.
  const fromPdf = byOldestUsed(eligible.filter((s) => !isHistoryOnlyVisitor(s)))
  if (fromPdf.length > 0) return fromPdf
  return byOldestUsed(eligible)
}

/** Active pending asks — not yet confirmed or declined. */
export function plannedLectures(data: AppData) {
  return data.lectures.filter((l) => l.status === 'planned')
}

export function pendingAskIds(data: AppData): {
  themeIds: Set<string>
  speakerIds: Set<string>
  chairIds: Set<string>
  readerIds: Set<string>
} {
  const themeIds = new Set<string>()
  const speakerIds = new Set<string>()
  const chairIds = new Set<string>()
  const readerIds = new Set<string>()
  for (const l of plannedLectures(data)) {
    if (l.themeId) themeIds.add(l.themeId)
    if (l.speakerId) speakerIds.add(l.speakerId)
    if (l.chairpersonId) chairIds.add(l.chairpersonId)
    if (l.readerId) readerIds.add(l.readerId)
  }
  return { themeIds, speakerIds, chairIds, readerIds }
}

/** Next Sunday (or today if already Sunday and includeToday). Default: upcoming Sunday. */
export function nextSundayISO(from = new Date(), includeToday = false): string {
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)
  const day = d.getDay() // 0 = Sunday
  let add = (7 - day) % 7
  if (add === 0 && !includeToday) add = 7
  d.setDate(d.getDate() + add)
  return d.toISOString().slice(0, 10)
}

export function upcomingSundays(count: number, from = new Date()): string[] {
  const first = nextSundayISO(from, from.getDay() === 0)
  const out: string[] = [first]
  for (let i = 1; i < count; i++) {
    const d = new Date(first + 'T12:00:00')
    d.setDate(d.getDate() + 7 * i)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

/**
 * Sundays from now through the end of (current year + yearsAhead).
 * Default: this year and the next two (e.g. 2026 → through 2028).
 */
export function sundaysThroughYearEnd(
  from = new Date(),
  yearsAhead = 2,
): string[] {
  const endYear = from.getFullYear() + Math.max(0, yearsAhead)
  const end = new Date(`${endYear}-12-31T12:00:00`)
  const first = nextSundayISO(from, from.getDay() === 0)
  const out: string[] = []
  const d = new Date(first + 'T12:00:00')
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10))
    d.setDate(d.getDate() + 7)
  }
  return out.length ? out : upcomingSundays(16, from)
}

/** Extend a Sunday list so every active lecture date is included. */
export function sundaysCoveringLectures(
  data: AppData,
  from = new Date(),
  yearsAhead = 2,
): string[] {
  const base = sundaysThroughYearEnd(from, yearsAhead)
  const bySet = new Set(base)
  let maxIso = base[base.length - 1] ?? ''
  for (const l of data.lectures) {
    if (l.status === 'declined' || l.status === 'deferred') continue
    if (l.date > maxIso) maxIso = l.date
    if (l.date >= (base[0] ?? '') && !bySet.has(l.date)) {
      bySet.add(l.date)
    }
  }
  if (maxIso && maxIso > (base[base.length - 1] ?? '')) {
    const d = new Date((base[base.length - 1] ?? nextSundayISO(from)) + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    while (d.toISOString().slice(0, 10) <= maxIso) {
      bySet.add(d.toISOString().slice(0, 10))
      d.setDate(d.getDate() + 7)
    }
  }
  return [...bySet].sort()
}

/** Date has an active booking (not declined/deferred). */
export function isDateBooked(data: AppData, date: string): boolean {
  return data.lectures.some(
    (l) =>
      l.date === date && l.status !== 'declined' && l.status !== 'deferred',
  )
}

/** Next Sunday with no active booking in the calendar/history. */
export function nextFreeSundayISO(
  data: AppData,
  from = new Date(),
  includeToday = false,
): string {
  let date = nextSundayISO(from, includeToday)
  for (let i = 0; i < 104; i++) {
    if (!isDateBooked(data, date)) return date
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + 7)
    date = d.toISOString().slice(0, 10)
  }
  return date
}

/** @deprecated use nextSundayISO */
export function nextMondayISO(from = new Date()): string {
  return nextSundayISO(from)
}

export function applyLectureToLists(
  data: AppData,
  lecture: { themeId: string; speakerId: string; date: string; status: string },
): AppData {
  const markUsed = lecture.status === 'confirmed' || lecture.status === 'done'
  if (!markUsed) return data

  return {
    ...data,
    themes: data.themes.map((t) =>
      t.id === lecture.themeId
        ? {
            ...t,
            lastUsedAt:
              !t.lastUsedAt || lecture.date >= t.lastUsedAt
                ? lecture.date
                : t.lastUsedAt,
          }
        : t,
    ),
    speakers: data.speakers.map((s) =>
      s.id === lecture.speakerId
        ? {
            ...s,
            lastUsedAt:
              !s.lastUsedAt || lecture.date >= s.lastUsedAt
                ? lecture.date
                : s.lastUsedAt,
          }
        : s,
    ),
  }
}

export function createLecture(
  themeId: string,
  speakerId: string,
  date: string,
  status: 'planned' | 'confirmed' | 'done' | 'declined' | 'deferred' = 'planned',
  roles: {
    chairpersonId?: string | null
    readerId?: string | null
    eventKind?: LectureEventKind
    customTitle?: string
    notes?: string
  } = {},
) {
  return {
    id: uid(),
    date,
    themeId,
    speakerId,
    chairpersonId: roles.chairpersonId ?? null,
    readerId: roles.readerId ?? null,
    status,
    createdAt: new Date().toISOString(),
    notes: roles.notes ?? '',
    eventKind: roles.eventKind ?? 'talk',
    customTitle: roles.customTitle ?? '',
  }
}

/** Rebuild lastUsedAt from lecture history (confirmed/done). */
export function recomputeLastUsed(data: AppData): AppData {
  const themeLast = new Map<string, string>()
  const speakerLast = new Map<string, string>()
  const chairLast = new Map<string, string>()
  const readerLast = new Map<string, string>()

  for (const lec of data.lectures) {
    if (lec.status !== 'confirmed' && lec.status !== 'done') continue
    if (lec.themeId) {
      const prevT = themeLast.get(lec.themeId)
      if (!prevT || lec.date > prevT) themeLast.set(lec.themeId, lec.date)
    }
    if (lec.speakerId) {
      const prevS = speakerLast.get(lec.speakerId)
      if (!prevS || lec.date > prevS) speakerLast.set(lec.speakerId, lec.date)
    }
    if (lec.chairpersonId) {
      const prevC = chairLast.get(lec.chairpersonId)
      if (!prevC || lec.date > prevC) chairLast.set(lec.chairpersonId, lec.date)
    }
    if (lec.readerId) {
      const prevR = readerLast.get(lec.readerId)
      if (!prevR || lec.date > prevR) readerLast.set(lec.readerId, lec.date)
    }
  }

  return {
    ...data,
    themes: data.themes.map((t) => ({
      ...t,
      lastUsedAt: themeLast.get(t.id) ?? null,
    })),
    speakers: data.speakers.map((s) => ({
      ...s,
      lastUsedAt: speakerLast.get(s.id) ?? null,
    })),
    chairpersons: data.chairpersons.map((p) => ({
      ...p,
      lastUsedAt: chairLast.get(p.id) ?? null,
    })),
    readers: data.readers.map((p) => ({
      ...p,
      lastUsedAt: readerLast.get(p.id) ?? null,
    })),
  }
}

export function rankRolePeople<T extends { id: string; lastUsedAt: string | null; name: string }>(
  people: T[],
  skipIds: string[] = [],
): T[] {
  return byOldestUsed(people, new Set(skipIds))
}

export function recommendNextRole<
  T extends { id: string; lastUsedAt: string | null; name: string },
>(people: T[], skipIds: string[] = []): T | null {
  return rankRolePeople(people, skipIds)[0] ?? null
}

/** Latest assignment date per role id from active lectures (incl. planned asks). */
function roleAssignmentDates(
  data: AppData,
  field: 'chairpersonId' | 'readerId',
): Map<string, string> {
  const map = new Map<string, string>()
  for (const lec of data.lectures) {
    if (lec.status === 'declined' || lec.status === 'deferred') continue
    const id = lec[field]
    if (!id) continue
    const prev = map.get(id)
    if (!prev || lec.date > prev) map.set(id, lec.date)
  }
  return map
}

function withAssignmentLastUsed(
  people: RolePerson[],
  assigned: Map<string, string>,
): RolePerson[] {
  return people.map((p) => {
    const fromLecture = assigned.get(p.id) ?? null
    const stored = p.lastUsedAt
    let lastUsedAt = stored
    if (fromLecture && (!stored || fromLecture > stored)) {
      lastUsedAt = fromLecture
    }
    return lastUsedAt === p.lastUsedAt ? p : { ...p, lastUsedAt }
  })
}

/** Pick reader for a given chairperson. */
export function readerForChairperson(
  data: AppData,
  chair: RolePerson | null,
  skipReaderIds: string[] = [],
): RolePerson | null {
  if (!chair) {
    return recommendNextRole(data.readers, skipReaderIds)
  }

  // Lukija-täppä: always the same person — never fall through to the reader rotation
  if (chair.alsoReads) {
    const same = data.readers.find(
      (r) => normName(r.name) === normName(chair.name),
    )
    return same ?? chair
  }

  // Exclude the chairperson themselves from substitute-reader rotation
  const skip = new Set(skipReaderIds)
  const chairKey = normName(chair.name)
  for (const r of data.readers) {
    if (normName(r.name) === chairKey) skip.add(r.id)
  }

  return recommendNextRole(data.readers, [...skip])
}

/**
 * Recommend chairperson + reader together.
 * Rotates through the full lists by oldest assignment (confirmed + pending asks).
 * alsoReads → same person as reader. Otherwise → next substitute reader.
 */
export function recommendChairAndReader(
  data: AppData,
  options: { skipChairIds?: string[]; skipReaderIds?: string[] } = {},
): { chair: RolePerson | null; reader: RolePerson | null } {
  // Count planned WhatsApp asks as “used” for rotation — do not remove people
  // from the pool (that emptied the list after one full round of asks).
  const chairs = withAssignmentLastUsed(
    data.chairpersons,
    roleAssignmentDates(data, 'chairpersonId'),
  )
  const readers = withAssignmentLastUsed(
    data.readers,
    roleAssignmentDates(data, 'readerId'),
  )
  const roleData: AppData = { ...data, chairpersons: chairs, readers }

  const chair = recommendNextRole(chairs, options.skipChairIds ?? [])
  const readerSkip = chair?.alsoReads ? [] : (options.skipReaderIds ?? [])
  return {
    chair,
    reader: readerForChairperson(roleData, chair, readerSkip),
  }
}

function normName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function uniqueCongregations(speakers: Speaker[]): string[] {
  return congregationFilterOptions(speakers.map((s) => s.congregation))
}

/**
 * Ensure every alsoReads chairperson has a matching entry on the readers list
 * (needed for PDF / calendar ids). Safe to run repeatedly.
 */
export function ensureAlsoReadsOnReadersList(data: AppData): AppData {
  let readers = data.readers
  let changed = false
  for (const chair of data.chairpersons) {
    if (!chair.alsoReads) continue
    const key = normName(chair.name)
    if (readers.some((r) => normName(r.name) === key)) continue
    readers = [
      ...readers,
      {
        id: uid(),
        name: chair.name,
        phone: chair.phone,
        notes: 'Lisätty puheenjohtajan Lukija-täpästä',
        lastUsedAt: chair.lastUsedAt,
        alsoReads: false,
      },
    ]
    changed = true
  }
  if (!changed) return data
  return {
    ...data,
    readers: [...readers].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
  }
}
