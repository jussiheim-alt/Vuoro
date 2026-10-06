import type { AppData, Speaker, Theme } from '../types'
import { isRetiredOutline } from './retiredOutlines'
import { recomputeLastUsed } from './recommend'

function stripRetiredOutlines(outlines: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of outlines) {
    const o = String(raw).trim()
    if (!o || isRetiredOutline(o) || seen.has(o)) continue
    seen.add(o)
    out.push(o)
  }
  return out
}

function mergeThemes(existing: Theme[], incoming: Theme[]): Theme[] {
  const byNum = new Map(
    existing.filter((t) => t.number).map((t) => [t.number, t]),
  )
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]))
  const used = new Set<string>()
  const out: Theme[] = []

  for (const neu of incoming) {
    const prev =
      (neu.number ? byNum.get(neu.number) : undefined) ??
      byName.get(neu.name.toLowerCase())
    if (prev) {
      used.add(prev.id)
      out.push({
        ...prev,
        number: neu.number || prev.number,
        name: neu.name || prev.name,
        disabled: neu.disabled,
        notes: neu.notes || prev.notes,
        // keep lastUsedAt from history
      })
    } else {
      out.push(neu)
    }
  }

  // keep old themes not in new list but mark? Better drop disabled orphans from old that aren't in new numbered set
  for (const old of existing) {
    if (used.has(old.id)) continue
    // keep if has history usage
    if (old.lastUsedAt) out.push(old)
  }

  return out.sort((a, b) => {
    const an = Number(a.number)
    const bn = Number(b.number)
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
    return a.number.localeCompare(b.number, 'fi')
  })
}

/**
 * Replace the active roster from the congregation PDF.
 * Speakers who only appear in history stay for lookup but are off the roster
 * (hidden from Puhujat / recommendations).
 */
function replaceSpeakersFromRoster(
  existing: Speaker[],
  incoming: Speaker[],
  keepSpeakerIds: Set<string>,
): Speaker[] {
  const byPhone = new Map(
    existing
      .filter((s) => s.phone)
      .map((s) => [s.phone.replace(/\D/g, ''), s]),
  )
  const byName = new Map(existing.map((s) => [s.name.toLowerCase(), s]))
  const used = new Set<string>()
  const out: Speaker[] = []

  for (const neu of incoming) {
    const prev =
      byPhone.get(neu.phone.replace(/\D/g, '')) ??
      byName.get(neu.name.toLowerCase())
    const outlines = stripRetiredOutlines(
      neu.outlines.length ? neu.outlines : (prev?.outlines ?? []),
    )
    if (prev) {
      used.add(prev.id)
      out.push({
        ...prev,
        name: neu.name || prev.name,
        phone: neu.phone || prev.phone,
        congregation: neu.congregation || prev.congregation,
        outlines,
        notes: neu.notes || prev.notes,
        localOnly: neu.localOnly,
        assistant: neu.assistant,
        unavailable: prev.unavailable,
        unavailableReason: prev.unavailableReason,
        snoozeUntil: prev.snoozeUntil,
        onRoster: true,
      })
    } else {
      out.push({
        ...neu,
        outlines,
        onRoster: true,
      })
    }
  }

  for (const old of existing) {
    if (used.has(old.id)) continue
    if (!keepSpeakerIds.has(old.id)) continue
    out.push({
      ...old,
      outlines: stripRetiredOutlines(old.outlines),
      onRoster: false,
    })
  }

  return out.sort((a, b) => a.name.localeCompare(b.name, 'fi'))
}

/** Merge updated PDF lists while preserving ids used by history when possible. */
export function applyPdfListsToData(
  data: AppData,
  incoming: { themes: Theme[]; speakers: Speaker[] },
): AppData {
  const themes = incoming.themes.length
    ? mergeThemes(data.themes, incoming.themes)
    : data.themes
  const keepSpeakerIds = new Set(
    data.lectures.map((l) => l.speakerId).filter(Boolean),
  )
  const speakers = incoming.speakers.length
    ? replaceSpeakersFromRoster(data.speakers, incoming.speakers, keepSpeakerIds)
    : data.speakers

  const themeIds = new Set(themes.map((t) => t.id))
  const speakerIds = new Set(speakers.map((s) => s.id))
  const lectures = data.lectures.filter(
    (l) => themeIds.has(l.themeId) && speakerIds.has(l.speakerId),
  )

  return recomputeLastUsed({
    ...data,
    themes,
    speakers,
    lectures,
  })
}

/** Active speakers shown on Puhujat tab and used for recommendations. */
export function rosterSpeakers(speakers: Speaker[]): Speaker[] {
  return speakers.filter((s) => s.onRoster !== false)
}
