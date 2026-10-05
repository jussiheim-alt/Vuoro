import type { Lecture, LectureEventKind, Speaker, Theme } from '../types'

function canGive(speaker: Speaker, theme: Theme): boolean {
  if (!theme.number) return true
  return speaker.outlines.includes(theme.number)
}

export const EVENT_KIND_LABEL: Record<LectureEventKind, string> = {
  talk: 'Esitelmä',
  circuit_convention: 'Kierroskonventti',
  regional_convention: 'Aluekonventti',
  circuit_week: 'Kierrosviikko',
  memorial: 'Muistojuhla',
}

/** Uppercase title used on PDF schedule rows. */
export const EVENT_KIND_PDF_TITLE: Record<
  Exclude<LectureEventKind, 'talk'>,
  string
> = {
  circuit_convention: 'KIERROSKONVENTTI',
  regional_convention: 'ALUEKONVENTTI',
  circuit_week: 'KIERROSVIIKKO',
  memorial: 'MUISTOJUHLA',
}

export const EVENT_KIND_OPTIONS: Array<{
  id: LectureEventKind
  label: string
}> = [
  { id: 'talk', label: 'Esitelmä' },
  { id: 'circuit_convention', label: 'Kierroskonventti' },
  { id: 'regional_convention', label: 'Aluekonventti' },
  { id: 'circuit_week', label: 'Kierrosviikko' },
  { id: 'memorial', label: 'Muistojuhla' },
]

export function isLectureEventKind(raw: unknown): raw is LectureEventKind {
  return (
    raw === 'talk' ||
    raw === 'circuit_convention' ||
    raw === 'regional_convention' ||
    raw === 'circuit_week' ||
    raw === 'memorial'
  )
}

export function lectureEventKind(lec: Pick<Lecture, 'eventKind'>): LectureEventKind {
  return lec.eventKind ?? 'talk'
}

export function isConventionKind(kind: LectureEventKind): boolean {
  return kind === 'circuit_convention' || kind === 'regional_convention'
}

export function isSpecialProgramKind(kind: LectureEventKind): boolean {
  return kind === 'circuit_week' || kind === 'memorial'
}

export function needsSpeakerAndTheme(kind: LectureEventKind): boolean {
  return kind === 'talk'
}

export function needsChairperson(kind: LectureEventKind): boolean {
  return kind === 'talk' || isSpecialProgramKind(kind)
}

export function needsReader(kind: LectureEventKind): boolean {
  return kind === 'talk'
}

export function needsCustomTitle(kind: LectureEventKind): boolean {
  return isSpecialProgramKind(kind)
}

/** Themes a speaker can give (active themes only unless already selected). */
export function themesForSpeaker(
  themes: Theme[],
  speaker: Speaker | null | undefined,
  selectedThemeId?: string,
): Theme[] {
  const active = themes.filter(
    (t) => !t.disabled || t.id === selectedThemeId || t.number === '—',
  )
  if (!speaker) return active.filter((t) => !t.disabled || t.id === selectedThemeId)
  if (!speaker.outlines.length) {
    // No outline list → keep current selection visible, otherwise all active
    return active.filter((t) => !t.disabled || t.id === selectedThemeId)
  }
  return active.filter(
    (t) =>
      t.id === selectedThemeId ||
      (!t.disabled && t.number && canGive(speaker, t)),
  )
}

/** Speakers who can give a theme. */
export function speakersForTheme(
  speakers: Speaker[],
  theme: Theme | null | undefined,
  selectedSpeakerId?: string,
): Speaker[] {
  const sorted = [...speakers].sort((a, b) => a.name.localeCompare(b.name, 'fi'))
  if (!theme || !theme.number || theme.number === '—') return sorted
  return sorted.filter(
    (s) =>
      s.id === selectedSpeakerId ||
      (s.outlines.length > 0 && canGive(s, theme)),
  )
}

export function scheduleTitleForLecture(
  lec: Lecture,
  themeName: string | null | undefined,
): string {
  const kind = lectureEventKind(lec)
  if (kind === 'talk') return themeName?.trim() || '—'
  if (isSpecialProgramKind(kind)) {
    const custom = (lec.customTitle || '').trim()
    return custom || EVENT_KIND_PDF_TITLE[kind]
  }
  return EVENT_KIND_PDF_TITLE[kind]
}
