/** Official Kierros 6 congregation headers from the speaker PDF. */
export const CIRCUIT_CONGREGATIONS = [
  'Anjala',
  'Hamina',
  'Hartola',
  'Heinola',
  'Kausala',
  'Kotka-Itäinen',
  'Kotka-Läntinen',
  'Kouvola',
  'Lahti-Hennala',
  'Lahti-Kivimaa',
  'Lahti-Laune',
  'Loviisa',
  'Orimattila',
  'Porvoo-Itäinen',
  'Porvoo-Läntinen',
  'Sysmä',
  'Vääksy',
] as const

/** Visiting congregations that appear on real bookings (not circuit PDF). */
const KNOWN_VISITOR_CONGREGATIONS = [
  'Pälkäne',
  'Kärkölä',
  'Lohja-Eteläinen',
] as const

/** Parse errors / wrong-circuit leftovers that must not appear in filters. */
const INVALID_CONGREGATIONS = new Set(
  [
    'Mitä',
    'Kallio',
    'Tampere-pohjoinen',
    'Tampere-Pohjoinen',
    'Lahti-Eteläinen',
    'Lahti-Itäinen',
    'Lahti',
    'Kotka-Keskus',
    'Kotka-Pohjoinen',
    'Kuhmoinen',
  ].map((s) => s.toLowerCase()),
)

function fold(name: string): string {
  return name.trim().toLowerCase()
}

export function isValidCongregationName(name: string): boolean {
  const n = name.trim()
  if (n.length < 3) return false
  if (INVALID_CONGREGATIONS.has(fold(n))) return false
  // Interrogatives / other PDF scrap
  if (/^(mitä|mikä|missä|milloin|kuka|miksi|kuinka)$/i.test(n)) return false
  return true
}

/** Normalize a speaker congregation field (clear junk). */
export function sanitizeCongregation(raw: string | null | undefined): string {
  const n = (raw ?? '').trim()
  if (!n) return ''
  return isValidCongregationName(n) ? n : ''
}

export function congregationFilterOptions(names: string[]): string[] {
  const allow = new Set(
    [...CIRCUIT_CONGREGATIONS, ...KNOWN_VISITOR_CONGREGATIONS].map(fold),
  )
  return [
    ...new Set(
      names
        .map((n) => n.trim())
        .filter(Boolean)
        .filter(isValidCongregationName)
        .filter((n) => allow.has(fold(n))),
    ),
  ].sort((a, b) => a.localeCompare(b, 'fi'))
}
