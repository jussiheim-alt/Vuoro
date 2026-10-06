export type Theme = {
  id: string
  number: string
  name: string
  notes: string
  disabled: boolean
  lastUsedAt: string | null
}

export type Speaker = {
  id: string
  name: string
  phone: string
  congregation: string
  /** Outline / jäsennys numbers this speaker can give, e.g. ["16","54","S-31"] */
  outlines: string[]
  notes: string
  localOnly: boolean
  assistant: boolean
  lastUsedAt: string | null
  /**
   * Do not recommend this speaker until this date (YYYY-MM-DD).
   * Set when they ask to be contacted again later.
   */
  snoozeUntil: string | null
  /** Manual “ei käytettävissä” — excluded from recommendations while set. */
  unavailable: boolean
  /** Free-text reason shown with the unavailable mark. */
  unavailableReason: string
  /**
   * When false, speaker is kept only for history lookup (not on Puhujat list /
   * recommendations). Missing/undefined means on roster (legacy backups).
   */
  onRoster?: boolean
}

/** Local chairperson (puheenjohtaja) or reader (lukija). */
export type RolePerson = {
  id: string
  name: string
  phone: string
  notes: string
  lastUsedAt: string | null
  /**
   * Chairpersons only: when true, this person is also assigned as reader
   * for their own turn. When false, next reader is picked from the readers list.
   */
  alsoReads: boolean
}

export type LectureStatus =
  | 'planned'
  | 'confirmed'
  | 'done'
  | 'declined'
  | 'deferred'

/**
 * Calendar entry type.
 * - talk: normal Sunday public talk (theme + speaker + PJ + reader)
 * - circuit_convention / regional_convention: date only on PDF
 * - circuit_week / memorial: custom title + chairperson, no reader
 */
export type LectureEventKind =
  | 'talk'
  | 'circuit_convention'
  | 'regional_convention'
  | 'circuit_week'
  | 'memorial'

export type Lecture = {
  id: string
  date: string
  themeId: string
  speakerId: string
  chairpersonId: string | null
  readerId: string | null
  status: LectureStatus
  createdAt: string
  notes: string
  /** Defaults to "talk" when missing (older backups). */
  eventKind: LectureEventKind
  /** Free-text title for Kierrosviikko / Muistojuhla. */
  customTitle: string
}

export type Settings = {
  messageTemplate: string
  eventName: string
  /** Prefer weekly numbered outlines; exclude S-* special talks from auto recommend */
  recommendSpecialOutlines: boolean
  /** Include "vain lähiseurakuntiin" speakers in auto recommend */
  includeLocalOnly: boolean
  /** Include avustavat palvelijat in auto recommend */
  includeAssistants: boolean
  /**
   * If non-empty, only these congregations are used in recommendations.
   * Empty array = all congregations.
   */
  allowedCongregations: string[]
  /**
   * Recently skipped themes (oldest first). Kept out of recommendations
   * until enough other themes have been skipped (~10).
   */
  themeSkipCooldown: string[]
  /**
   * Recently skipped speakers (oldest first). Kept out of recommendations
   * until enough other speakers have been skipped (~10).
   */
  speakerSkipCooldown: string[]
}

export type AppData = {
  themes: Theme[]
  speakers: Speaker[]
  chairpersons: RolePerson[]
  readers: RolePerson[]
  lectures: Lecture[]
  settings: Settings
}

export type Recommendation = {
  theme: Theme
  speaker: Speaker
  themeDaysSince: number | null
  speakerDaysSince: number | null
  eligibleSpeakerCount: number
}
