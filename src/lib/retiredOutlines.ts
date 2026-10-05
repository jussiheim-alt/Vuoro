/**
 * Outlines withdrawn from use after 2026-09-01.
 * Kept disabled everywhere: recommendations and manual picks.
 */
export const RETIRED_OUTLINE_NUMBERS = [
  '84',
  '85',
  '87',
  '92',
  '94',
  '97',
  '105',
  '106',
  '109',
  '117',
  '119',
  '120',
  '124',
  '126',
  '139',
  '141',
  '144',
  '145',
  '148',
  '149',
  '151',
  '154',
  '155',
  '157',
  '158',
  '163',
  '164',
  '165',
  '167',
  '168',
] as const

const RETIRED = new Set<string>(RETIRED_OUTLINE_NUMBERS)

export const RETIRED_OUTLINES_SINCE = '2026-09-01'

export function isRetiredOutline(number: string | null | undefined): boolean {
  if (!number) return false
  return RETIRED.has(String(number).trim())
}

/** Force disabled + note for withdrawn outlines. */
export function applyRetiredOutlineFlags<
  T extends { number: string; disabled: boolean; notes: string },
>(theme: T): T {
  if (!isRetiredOutline(theme.number)) return theme
  const note = 'Poistettu käytöstä 1.9.2026 alkaen'
  const notes = theme.notes.includes('Poistettu käytöstä 1.9.2026')
    ? theme.notes
    : theme.notes
      ? `${theme.notes} · ${note}`
      : note
  if (theme.disabled && notes === theme.notes) return theme
  return { ...theme, disabled: true, notes }
}
