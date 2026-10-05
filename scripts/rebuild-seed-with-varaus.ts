import { readFileSync, writeFileSync } from 'fs'
import seedJson from '../public/kierros6-seed.json'
import { emptyData } from '../src/lib/storage'
import { applySeedToData } from '../src/lib/seed'
import {
  applyVarauslistaToData,
  parseVarauslistaBuffer,
} from '../src/lib/parseVarauslista'
import { isDateBooked, nextFreeSundayISO } from '../src/lib/recommend'

const seed = seedJson

const base = {
  ...seed,
  history: [],
  speakers: seed.speakers.map((s) => ({ ...s, lastUsedAt: null })),
  themes: seed.themes.map((t) => ({ ...t, lastUsedAt: null })),
}

let data = applySeedToData(emptyData(), base as never)
data = { ...data, lectures: [] }

const buf = readFileSync('./data/source/Esitelmien_varauslista_b5e5.xlsb')
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const parsed = parseVarauslistaBuffer(ab, data.themes, data.speakers)
data = applyVarauslistaToData(data, parsed)

console.log('lectures', data.lectures.length)
console.log(
  'future confirmed',
  data.lectures.filter((l) => l.status === 'confirmed').length,
)
for (const l of data.lectures
  .filter((x) => x.date.startsWith('2026-10'))
  .sort((a, b) => a.date.localeCompare(b.date))) {
  const sp = data.speakers.find((s) => s.id === l.speakerId)
  console.log(l.date, sp?.name, l.status)
}
const free = nextFreeSundayISO(data, new Date('2026-09-27T12:00:00'))
console.log('next free', free, '11.10 booked?', isDateBooked(data, '2026-10-11'))

const themeById = new Map(data.themes.map((t) => [t.id, t]))
const speakerById = new Map(data.speakers.map((s) => [s.id, s]))

const history = data.lectures.map((l) => {
  const th = themeById.get(l.themeId)
  const sp = speakerById.get(l.speakerId)
  return {
    date: l.date,
    outline: th?.number && th.number !== '—' ? th.number : '',
    speakerName: sp?.name ?? null,
    rawName: sp?.name ?? '',
    status: l.status,
    notes: l.notes,
  }
})

const lastOutline: Record<string, string> = {}
const lastSpeaker: Record<string, string> = {}
for (const l of [...data.lectures].sort((a, b) =>
  a.date.localeCompare(b.date),
)) {
  if (l.status !== 'done' && l.status !== 'confirmed') continue
  const th = themeById.get(l.themeId)
  const sp = speakerById.get(l.speakerId)
  if (th?.number && th.number !== '—') lastOutline[th.number] = l.date
  if (sp) lastSpeaker[sp.name.toLowerCase()] = l.date
}

const outSeed = {
  sourceDate: seed.sourceDate,
  kierros: seed.kierros,
  themes: data.themes
    .filter(
      (t) =>
        t.number !== '—' || data.lectures.some((l) => l.themeId === t.id),
    )
    .map((t) => ({
      number: t.number,
      name: t.name,
      disabled: t.disabled,
      lastUsedAt:
        t.number && t.number !== '—' ? (lastOutline[t.number] ?? null) : null,
    })),
  speakers: data.speakers.map((s) => ({
    name: s.name,
    phone: s.phone,
    congregation: s.congregation,
    outlines: s.outlines,
    notes: s.notes,
    localOnly: s.localOnly,
    assistant: s.assistant,
    lastUsedAt: lastSpeaker[s.name.toLowerCase()] ?? null,
  })),
  history,
  historyStats: {
    events: history.length,
    matched: history.length,
    futureBooked: history.filter((h) => h.status === 'confirmed').length,
    sourceFile: 'Esitelmien_varauslista_b5e5.xlsb',
    updatedAt: new Date().toISOString(),
  },
}

writeFileSync('./data/kierros6-seed.json', JSON.stringify(outSeed, null, 2))
writeFileSync('./public/kierros6-seed.json', JSON.stringify(outSeed))
console.log('written future', outSeed.historyStats.futureBooked)
