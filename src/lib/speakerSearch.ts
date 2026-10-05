import type { Speaker, Theme } from '../types'

function norm(s: string): string {
  return s.trim().toLocaleLowerCase('fi')
}

/** True if speaker matches free-text query (name, congregation, theme number/name). */
export function speakerMatchesQuery(
  speaker: Speaker,
  rawQuery: string,
  themes: Theme[],
): boolean {
  const q = norm(rawQuery)
  if (!q) return true

  if (norm(speaker.name).includes(q)) return true
  if (norm(speaker.congregation).includes(q)) return true
  if (norm(speaker.notes).includes(q)) return true
  if (norm(speaker.unavailableReason).includes(q)) return true
  if (q === 'ei käytettävissä' || q === 'ei kaytettavissa') {
    if (speaker.unavailable) return true
  }

  const phoneQ = q.replace(/\s+/g, '')
  if (phoneQ && speaker.phone.replace(/\s+/g, '').includes(phoneQ)) return true

  const outlines = speaker.outlines.map((o) => String(o))
  const outlineNorm = outlines.map((o) => norm(o))

  // Direct outline / theme number on the speaker
  if (outlineNorm.some((o) => o === q || o.includes(q))) return true

  // Theme catalog: match by number or (longer) name, then require speaker knows it
  const outlineSet = new Set(outlineNorm)
  for (const theme of themes) {
    const num = norm(String(theme.number))
    if (!num || !outlineSet.has(num)) continue
    if (num === q || num.includes(q)) return true
    // Theme title search — avoid 1–2 letter noise matching half the catalog
    if (q.length >= 3 && norm(theme.name).includes(q)) return true
  }

  return false
}

export function filterSpeakersByQuery(
  speakers: Speaker[],
  rawQuery: string,
  themes: Theme[],
): Speaker[] {
  const q = rawQuery.trim()
  if (!q) return speakers
  return speakers.filter((s) => speakerMatchesQuery(s, q, themes))
}
