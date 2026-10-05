import type { AppData, RolePerson } from '../types'
import { recomputeLastUsed } from './recommend'
import { uid } from './storage'

type ScheduleRow = {
  date: string
  chair: string
  chairPhone: string
  reader: string | null
}

/**
 * Roles from the sample PDF:
 * Esitelmät_PJ_6.9.2026_1.11.2026
 */
export const SYKSY_2026_ROLE_SCHEDULE: ScheduleRow[] = [
  {
    date: '2026-09-06',
    chair: 'Timo Michelsson',
    chairPhone: '0405535346',
    reader: 'Timo Michelsson',
  },
  {
    date: '2026-09-13',
    chair: 'Jani Mustonen',
    chairPhone: '0504015241',
    reader: null,
  },
  {
    date: '2026-09-20',
    chair: 'Petteri Korhonen',
    chairPhone: '0408251298',
    reader: 'Petteri Korhonen',
  },
  {
    date: '2026-09-26',
    chair: 'Teppo Takanen',
    chairPhone: '',
    reader: 'Teppo Takanen',
  },
  {
    date: '2026-10-04',
    chair: 'Joni Moilanen',
    chairPhone: '0451242699',
    reader: 'Joni Moilanen',
  },
  {
    date: '2026-10-11',
    chair: 'Seppo Moilanen',
    chairPhone: '',
    reader: 'Seppo Moilanen',
  },
  {
    date: '2026-10-18',
    chair: 'Jukka Mustonen',
    chairPhone: '0449871857',
    reader: 'Mika Färlin',
  },
  {
    date: '2026-10-25',
    chair: 'Jouni Lappalainen',
    chairPhone: '0451308695',
    reader: 'Jouni Lappalainen',
  },
  {
    date: '2026-11-01',
    chair: 'Teemu Tanskanen',
    chairPhone: '0503435910',
    reader: 'Teemu Tanskanen',
  },
]

/** Extra substitute readers who rotate when chair does not also read. */
const EXTRA_READERS = ['Jussi Heimonen']

function norm(name: string): string {
  return name.trim().toLowerCase()
}

function upsertPerson(
  list: RolePerson[],
  name: string,
  opts: {
    phone?: string
    alsoReads?: boolean
    lastUsedAt?: string | null
  },
): { list: RolePerson[]; id: string } {
  const key = norm(name)
  const existing = list.find((p) => norm(p.name) === key)
  if (existing) {
    const phone = existing.phone.trim() || opts.phone?.trim() || ''
    let lastUsedAt = existing.lastUsedAt
    if (opts.lastUsedAt) {
      if (!lastUsedAt || opts.lastUsedAt > lastUsedAt) {
        lastUsedAt = opts.lastUsedAt
      }
    }
    // Keep user's alsoReads choice for existing people
    const updated: RolePerson = {
      ...existing,
      phone,
      lastUsedAt,
    }
    return {
      list: list.map((p) => (p.id === existing.id ? updated : p)),
      id: existing.id,
    }
  }

  const person: RolePerson = {
    id: uid(),
    name,
    phone: opts.phone?.trim() ?? '',
    notes: 'Tuotu syksyn 2026 PJ-listasta',
    lastUsedAt: opts.lastUsedAt ?? null,
    alsoReads: opts.alsoReads ?? false,
  }
  return {
    list: [...list, person].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    id: person.id,
  }
}

/**
 * Merge chairpersons/readers from the autumn 2026 PDF sample into app data
 * and attach them to matching calendar lectures by date.
 */
export function applySyksy2026Roles(data: AppData): AppData {
  let chairpersons = [...data.chairpersons]
  let readers = [...data.readers]

  // Chairs: alsoReads when they read themselves on their turn
  const chairAlsoReads = new Map<string, boolean>()
  for (const row of SYKSY_2026_ROLE_SCHEDULE) {
    const self =
      !!row.reader && norm(row.reader) === norm(row.chair)
    const prev = chairAlsoReads.get(norm(row.chair))
    // If any turn shows they don't read themselves → not alsoReads
    if (prev === false) continue
    chairAlsoReads.set(norm(row.chair), self)
  }

  for (const row of SYKSY_2026_ROLE_SCHEDULE) {
    const alsoReads = chairAlsoReads.get(norm(row.chair)) ?? false
    const up = upsertPerson(chairpersons, row.chair, {
      phone: row.chairPhone,
      alsoReads,
      lastUsedAt: row.date,
    })
    chairpersons = up.list

    if (row.reader) {
      const rup = upsertPerson(readers, row.reader, {
        phone:
          norm(row.reader) === norm(row.chair) ? row.chairPhone : undefined,
        alsoReads: false,
        lastUsedAt: row.date,
      })
      readers = rup.list
    }
  }

  for (const name of EXTRA_READERS) {
    const up = upsertPerson(readers, name, { alsoReads: false })
    readers = up.list
  }

  const chairByName = new Map(chairpersons.map((p) => [norm(p.name), p.id]))
  const readerByName = new Map(readers.map((p) => [norm(p.name), p.id]))

  const lectures = data.lectures.map((l) => {
    const row = SYKSY_2026_ROLE_SCHEDULE.find((r) => r.date === l.date)
    if (!row) return l
    return {
      ...l,
      chairpersonId: chairByName.get(norm(row.chair)) ?? l.chairpersonId,
      readerId: row.reader
        ? (readerByName.get(norm(row.reader)) ?? l.readerId)
        : null,
    }
  })

  const recomputed = recomputeLastUsed({
    ...data,
    chairpersons,
    readers,
    lectures,
  })

  // Keep schedule dates even when a matching calendar lecture is missing
  const chairLastFromSchedule = new Map<string, string>()
  const readerLastFromSchedule = new Map<string, string>()
  for (const row of SYKSY_2026_ROLE_SCHEDULE) {
    const cId = chairByName.get(norm(row.chair))
    if (cId) {
      const prev = chairLastFromSchedule.get(cId)
      if (!prev || row.date > prev) chairLastFromSchedule.set(cId, row.date)
    }
    if (row.reader) {
      const rId = readerByName.get(norm(row.reader))
      if (rId) {
        const prev = readerLastFromSchedule.get(rId)
        if (!prev || row.date > prev) readerLastFromSchedule.set(rId, row.date)
      }
    }
  }

  return {
    ...recomputed,
    chairpersons: recomputed.chairpersons.map((p) => {
      const fromSchedule = chairLastFromSchedule.get(p.id)
      if (fromSchedule && (!p.lastUsedAt || fromSchedule > p.lastUsedAt)) {
        return { ...p, lastUsedAt: fromSchedule }
      }
      return p
    }),
    readers: recomputed.readers.map((p) => {
      const fromSchedule = readerLastFromSchedule.get(p.id)
      if (fromSchedule && (!p.lastUsedAt || fromSchedule > p.lastUsedAt)) {
        return { ...p, lastUsedAt: fromSchedule }
      }
      return p
    }),
  }
}

export function syksy2026RoleSummary(data: AppData): string {
  const dates = new Set(SYKSY_2026_ROLE_SCHEDULE.map((r) => r.date))
  const matched = data.lectures.filter((l) => dates.has(l.date)).length
  return `${data.chairpersons.length} puheenjohtajaa, ${data.readers.length} lukijaa, ${matched} kalenteripäivää päivitetty`
}
