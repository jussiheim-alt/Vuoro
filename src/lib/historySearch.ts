import type { AppData, Lecture } from '../types'
import { themeLabel } from './storage'

function norm(s: string): string {
  return s.trim().toLocaleLowerCase('fi')
}

/** Match history rows by speaker/theme name, outline number, PJ/lukija, or title. */
export function lectureMatchesHistoryQuery(
  lecture: Lecture,
  rawQuery: string,
  data: Pick<AppData, 'themes' | 'speakers' | 'chairpersons' | 'readers'>,
): boolean {
  const q = norm(rawQuery)
  if (!q) return true

  const theme = data.themes.find((t) => t.id === lecture.themeId)
  const speaker = data.speakers.find((s) => s.id === lecture.speakerId)
  const chair = data.chairpersons.find((p) => p.id === lecture.chairpersonId)
  const reader = data.readers.find((p) => p.id === lecture.readerId)

  if (theme) {
    if (norm(theme.number).includes(q)) return true
    if (norm(theme.name).includes(q)) return true
    if (norm(themeLabel(theme)).includes(q)) return true
  }
  if (speaker && norm(speaker.name).includes(q)) return true
  if (chair && norm(chair.name).includes(q)) return true
  if (reader && norm(reader.name).includes(q)) return true
  if (lecture.customTitle && norm(lecture.customTitle).includes(q)) return true
  if (lecture.notes && norm(lecture.notes).includes(q)) return true

  return false
}

export function filterLecturesByHistoryQuery(
  lectures: Lecture[],
  rawQuery: string,
  data: Pick<AppData, 'themes' | 'speakers' | 'chairpersons' | 'readers'>,
): Lecture[] {
  const q = rawQuery.trim()
  if (!q) return lectures
  return lectures.filter((l) => lectureMatchesHistoryQuery(l, q, data))
}
