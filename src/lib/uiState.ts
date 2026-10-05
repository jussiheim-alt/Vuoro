import {
  THEME_CATEGORIES,
  type ThemeCategoryId,
} from './themeCategories'
import type { RecommendMode } from './recommend'

export type Tab =
  | 'suositus'
  | 'kalenteri'
  | 'teemat'
  | 'puhujat'
  | 'puheenjohtajat'
  | 'lukijat'
  | 'historia'
  | 'pdf-listat'
  | 'tuonti'
  | 'asetukset'

export type UiState = {
  tab: Tab
  lectureDate: string | null
  skipSpeakers: string[]
  skipThemes: string[]
  skipChairs: string[]
  skipReaders: string[]
  messageDraft: string
  speakerQuery: string
  editingSpeakerId: string | null
  editingThemeId: string | null
  recMode: RecommendMode
  recTopicCategory: ThemeCategoryId | null
  recCongregation: string | null
}

const UI_KEY = 'vuoro-ui-v1'
const TAB_KEY_LEGACY = 'vuoro-active-tab'

const TABS: Tab[] = [
  'suositus',
  'kalenteri',
  'teemat',
  'puhujat',
  'puheenjohtajat',
  'lukijat',
  'historia',
  'pdf-listat',
  'tuonti',
  'asetukset',
]

const REC_MODES: RecommendMode[] = ['longest', 'topic', 'congregation']
const TOPIC_IDS = new Set(THEME_CATEGORIES.map((c) => c.id))

export function isTab(raw: unknown): raw is Tab {
  return typeof raw === 'string' && (TABS as string[]).includes(raw)
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((x): x is string => typeof x === 'string')
}

function asRecMode(raw: unknown): RecommendMode {
  return typeof raw === 'string' && (REC_MODES as string[]).includes(raw)
    ? (raw as RecommendMode)
    : 'longest'
}

function asTopicCategory(raw: unknown): ThemeCategoryId | null {
  return typeof raw === 'string' && TOPIC_IDS.has(raw as ThemeCategoryId)
    ? (raw as ThemeCategoryId)
    : null
}

export function loadUiState(): UiState {
  const empty: UiState = {
    tab: 'suositus',
    lectureDate: null,
    skipSpeakers: [],
    skipThemes: [],
    skipChairs: [],
    skipReaders: [],
    messageDraft: '',
    speakerQuery: '',
    editingSpeakerId: null,
    editingThemeId: null,
    recMode: 'longest',
    recTopicCategory: null,
    recCongregation: null,
  }
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UiState>
      return {
        tab: isTab(parsed.tab) ? parsed.tab : 'suositus',
        lectureDate:
          typeof parsed.lectureDate === 'string' ? parsed.lectureDate : null,
        skipSpeakers: asStringArray(parsed.skipSpeakers),
        skipThemes: asStringArray(parsed.skipThemes),
        skipChairs: asStringArray(parsed.skipChairs),
        skipReaders: asStringArray(parsed.skipReaders),
        messageDraft:
          typeof parsed.messageDraft === 'string' ? parsed.messageDraft : '',
        speakerQuery:
          typeof parsed.speakerQuery === 'string' ? parsed.speakerQuery : '',
        editingSpeakerId:
          typeof parsed.editingSpeakerId === 'string'
            ? parsed.editingSpeakerId
            : null,
        editingThemeId:
          typeof parsed.editingThemeId === 'string'
            ? parsed.editingThemeId
            : null,
        recMode: asRecMode(parsed.recMode),
        recTopicCategory: asTopicCategory(parsed.recTopicCategory),
        recCongregation:
          typeof parsed.recCongregation === 'string' &&
          parsed.recCongregation.trim()
            ? parsed.recCongregation.trim()
            : null,
      }
    }
    const legacy =
      sessionStorage.getItem(TAB_KEY_LEGACY) ??
      localStorage.getItem(TAB_KEY_LEGACY)
    if (isTab(legacy)) return { ...empty, tab: legacy }
  } catch {
    /* ignore */
  }
  return empty
}

export function saveUiState(state: UiState): void {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(state))
    localStorage.setItem(TAB_KEY_LEGACY, state.tab)
  } catch {
    /* ignore */
  }
}
