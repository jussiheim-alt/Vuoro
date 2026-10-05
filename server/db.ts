import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import { dataDir, ensureDataDir } from './paths.ts'

ensureDataDir()
export const dbPath = path.join(dataDir, 'vuoro.sqlite')

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY,
  number TEXT,
  name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  disabled INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS speakers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  congregation TEXT DEFAULT '',
  outlines_json TEXT DEFAULT '[]',
  notes TEXT DEFAULT '',
  local_only INTEGER NOT NULL DEFAULT 0,
  assistant INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  snooze_until TEXT,
  unavailable INTEGER NOT NULL DEFAULT 0,
  unavailable_reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS chairpersons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  last_used_at TEXT,
  also_reads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS readers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  last_used_at TEXT,
  also_reads INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lectures (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  theme_id TEXT,
  speaker_id TEXT,
  chairperson_id TEXT,
  reader_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  created_at TEXT NOT NULL,
  notes TEXT DEFAULT '',
  event_kind TEXT NOT NULL DEFAULT 'talk',
  custom_title TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_archives (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  kind TEXT,
  filename TEXT,
  from_date TEXT,
  to_date TEXT,
  entry_count INTEGER,
  mime_type TEXT,
  blob_base64 TEXT
);

CREATE INDEX IF NOT EXISTS idx_lectures_date ON lectures(date);
`)

export type UserRow = {
  id: string
  username: string
  name: string
  password_hash: string
  role: string
  active: number
  created_at: string
}

export function ensureAdminUser() {
  const username = (process.env.ADMIN_USERNAME || 'jussi').trim()
  const password = (process.env.ADMIN_PASSWORD || '').trim()
  const name = (process.env.ADMIN_NAME || 'Jussi Heimonen').trim()
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username)
  if (existing) return
  if (!password || password.length < 6) {
    console.warn('ADMIN_PASSWORD puuttuu (min. 6) — adminia ei seedattu')
    return
  }
  db.prepare(
    `INSERT INTO users (id, username, name, password_hash, role, active, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, ?)`,
  ).run(crypto.randomUUID(), username, name, bcrypt.hashSync(password, 10), new Date().toISOString())
  console.log(`Luotu admin-käyttäjä: ${username}`)
}

export type VuoroBackup = {
  format: string
  version: number
  exportedAt?: string
  data: {
    themes?: unknown[]
    speakers?: unknown[]
    chairpersons?: unknown[]
    readers?: unknown[]
    lectures?: unknown[]
    settings?: Record<string, unknown>
  }
  pdfArchives?: unknown[]
}

export function importBackup(backup: VuoroBackup, { replace = true } = {}) {
  if (backup.format !== 'vuoro-backup') {
    throw new Error('Tiedosto ei ole Vuoro-varmuuskopio (format ≠ vuoro-backup)')
  }
  const d = backup.data || {}
  const tx = db.transaction(() => {
    if (replace) {
      db.exec(`
        DELETE FROM lectures;
        DELETE FROM themes;
        DELETE FROM speakers;
        DELETE FROM chairpersons;
        DELETE FROM readers;
        DELETE FROM settings;
        DELETE FROM pdf_archives;
      `)
    }

    const insTheme = db.prepare(
      `INSERT OR REPLACE INTO themes (id, number, name, notes, disabled, last_used_at)
       VALUES (@id, @number, @name, @notes, @disabled, @lastUsedAt)`,
    )
    for (const t of (d.themes || []) as Record<string, unknown>[]) {
      insTheme.run({
        id: String(t.id),
        number: t.number == null ? null : String(t.number),
        name: String(t.name || ''),
        notes: String(t.notes || ''),
        disabled: t.disabled ? 1 : 0,
        lastUsedAt: t.lastUsedAt ? String(t.lastUsedAt) : null,
      })
    }

    const insSp = db.prepare(
      `INSERT OR REPLACE INTO speakers
        (id, name, phone, congregation, outlines_json, notes, local_only, assistant,
         last_used_at, snooze_until, unavailable, unavailable_reason)
       VALUES (@id, @name, @phone, @congregation, @outlines, @notes, @localOnly, @assistant,
         @lastUsedAt, @snoozeUntil, @unavailable, @unavailableReason)`,
    )
    for (const s of (d.speakers || []) as Record<string, unknown>[]) {
      insSp.run({
        id: String(s.id),
        name: String(s.name || ''),
        phone: String(s.phone || ''),
        congregation: String(s.congregation || ''),
        outlines: JSON.stringify(s.outlines || []),
        notes: String(s.notes || ''),
        localOnly: s.localOnly ? 1 : 0,
        assistant: s.assistant ? 1 : 0,
        lastUsedAt: s.lastUsedAt ? String(s.lastUsedAt) : null,
        snoozeUntil: s.snoozeUntil ? String(s.snoozeUntil) : null,
        unavailable: s.unavailable ? 1 : 0,
        unavailableReason: String(s.unavailableReason || ''),
      })
    }

    const insChair = db.prepare(
      `INSERT OR REPLACE INTO chairpersons (id, name, phone, notes, last_used_at, also_reads)
       VALUES (@id, @name, @phone, @notes, @lastUsedAt, @alsoReads)`,
    )
    for (const c of (d.chairpersons || []) as Record<string, unknown>[]) {
      insChair.run({
        id: String(c.id),
        name: String(c.name || ''),
        phone: String(c.phone || ''),
        notes: String(c.notes || ''),
        lastUsedAt: c.lastUsedAt ? String(c.lastUsedAt) : null,
        alsoReads: c.alsoReads ? 1 : 0,
      })
    }

    const insReader = db.prepare(
      `INSERT OR REPLACE INTO readers (id, name, phone, notes, last_used_at, also_reads)
       VALUES (@id, @name, @phone, @notes, @lastUsedAt, @alsoReads)`,
    )
    for (const r of (d.readers || []) as Record<string, unknown>[]) {
      insReader.run({
        id: String(r.id),
        name: String(r.name || ''),
        phone: String(r.phone || ''),
        notes: String(r.notes || ''),
        lastUsedAt: r.lastUsedAt ? String(r.lastUsedAt) : null,
        alsoReads: r.alsoReads ? 1 : 0,
      })
    }

    const insLec = db.prepare(
      `INSERT OR REPLACE INTO lectures
        (id, date, theme_id, speaker_id, chairperson_id, reader_id, status, created_at, notes, event_kind, custom_title)
       VALUES (@id, @date, @themeId, @speakerId, @chairpersonId, @readerId, @status, @createdAt, @notes, @eventKind, @customTitle)`,
    )
    for (const l of (d.lectures || []) as Record<string, unknown>[]) {
      insLec.run({
        id: String(l.id),
        date: String(l.date),
        themeId: l.themeId ? String(l.themeId) : null,
        speakerId: l.speakerId ? String(l.speakerId) : null,
        chairpersonId: l.chairpersonId ? String(l.chairpersonId) : null,
        readerId: l.readerId ? String(l.readerId) : null,
        status: String(l.status || 'planned'),
        createdAt: String(l.createdAt || new Date().toISOString()),
        notes: String(l.notes || ''),
        eventKind: String(l.eventKind || 'talk'),
        customTitle: String(l.customTitle || ''),
      })
    }

    if (d.settings && typeof d.settings === 'object') {
      for (const [key, value] of Object.entries(d.settings)) {
        db.prepare(`INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)`).run(
          key,
          JSON.stringify(value),
        )
      }
    }

    const insPdf = db.prepare(
      `INSERT OR REPLACE INTO pdf_archives
        (id, created_at, kind, filename, from_date, to_date, entry_count, mime_type, blob_base64)
       VALUES (@id, @createdAt, @kind, @filename, @fromDate, @toDate, @entryCount, @mimeType, @blobBase64)`,
    )
    for (const p of (backup.pdfArchives || []) as Record<string, unknown>[]) {
      insPdf.run({
        id: String(p.id),
        createdAt: String(p.createdAt || new Date().toISOString()),
        kind: p.kind ? String(p.kind) : null,
        filename: p.filename ? String(p.filename) : null,
        fromDate: p.fromDate ? String(p.fromDate) : null,
        toDate: p.toDate ? String(p.toDate) : null,
        entryCount: Number(p.entryCount || 0),
        mimeType: p.mimeType ? String(p.mimeType) : 'application/pdf',
        blobBase64: p.blobBase64 ? String(p.blobBase64) : null,
      })
    }
  })
  tx()
  return {
    themes: (d.themes || []).length,
    speakers: (d.speakers || []).length,
    chairpersons: (d.chairpersons || []).length,
    readers: (d.readers || []).length,
    lectures: (d.lectures || []).length,
    pdfArchives: (backup.pdfArchives || []).length,
  }
}

export function exportBackup(): VuoroBackup {
  const themes = db.prepare(`SELECT * FROM themes`).all() as Record<string, unknown>[]
  const speakers = db.prepare(`SELECT * FROM speakers`).all() as Record<string, unknown>[]
  const chairpersons = db.prepare(`SELECT * FROM chairpersons`).all() as Record<string, unknown>[]
  const readers = db.prepare(`SELECT * FROM readers`).all() as Record<string, unknown>[]
  const lectures = db.prepare(`SELECT * FROM lectures`).all() as Record<string, unknown>[]
  const settingsRows = db.prepare(`SELECT key, value_json FROM settings`).all() as {
    key: string
    value_json: string
  }[]
  const pdfArchives = db.prepare(`SELECT * FROM pdf_archives`).all() as Record<string, unknown>[]

  const settings: Record<string, unknown> = {}
  for (const r of settingsRows) settings[r.key] = JSON.parse(r.value_json)

  return {
    format: 'vuoro-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      themes: themes.map((t) => ({
        id: t.id,
        number: t.number,
        name: t.name,
        notes: t.notes,
        disabled: !!t.disabled,
        lastUsedAt: t.last_used_at,
      })),
      speakers: speakers.map((s) => ({
        id: s.id,
        name: s.name,
        phone: s.phone,
        congregation: s.congregation,
        outlines: JSON.parse(String(s.outlines_json || '[]')),
        notes: s.notes,
        localOnly: !!s.local_only,
        assistant: !!s.assistant,
        lastUsedAt: s.last_used_at,
        snoozeUntil: s.snooze_until,
        unavailable: !!s.unavailable,
        unavailableReason: s.unavailable_reason,
      })),
      chairpersons: chairpersons.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
        notes: c.notes,
        lastUsedAt: c.last_used_at,
        alsoReads: !!c.also_reads,
      })),
      readers: readers.map((r) => ({
        id: r.id,
        name: r.name,
        phone: r.phone,
        notes: r.notes,
        lastUsedAt: r.last_used_at,
        alsoReads: !!r.also_reads,
      })),
      lectures: lectures.map((l) => ({
        id: l.id,
        date: l.date,
        themeId: l.theme_id,
        speakerId: l.speaker_id,
        chairpersonId: l.chairperson_id,
        readerId: l.reader_id,
        status: l.status,
        createdAt: l.created_at,
        notes: l.notes,
        eventKind: l.event_kind,
        customTitle: l.custom_title,
      })),
      settings,
    },
    pdfArchives: pdfArchives.map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      kind: p.kind,
      filename: p.filename,
      fromDate: p.from_date,
      toDate: p.to_date,
      entryCount: p.entry_count,
      mimeType: p.mime_type,
      blobBase64: p.blob_base64,
    })),
  }
}

export function autoImportBackupIfEmpty() {
  try {
    const n = (db.prepare('SELECT COUNT(*) AS c FROM lectures').get() as { c: number }).c
    if (n > 0) return null
    const candidates = [
      path.join(dataDir, 'vuoro-varmuuskopio-slim.json'),
      path.join(process.cwd(), 'data', 'vuoro-varmuuskopio-slim.json'),
      path.join(dataDir, 'vuoro-varmuuskopio.json'),
      path.join(process.cwd(), 'data', 'vuoro-varmuuskopio.json'),
      process.env.BACKUP_FILE || '',
    ].filter(Boolean)
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue
      console.log(`Tuodaan varmuuskopio: ${file}`)
      const backup = JSON.parse(fs.readFileSync(file, 'utf8')) as VuoroBackup
      // PDF-blobit jätetään pois bootissa (muisti). Tuo täysi JSON Asetuksista tarvittaessa.
      const safe: VuoroBackup = {
        ...backup,
        pdfArchives: Array.isArray(backup.pdfArchives)
          ? backup.pdfArchives.map((p: any) => ({
              ...p,
              blobBase64: undefined,
            }))
          : [],
      }
      const stats = importBackup(safe)
      console.log(`Tuotu varmuuskopio ${file}:`, stats)
      return stats
    }
  } catch (e) {
    console.error('Varmuuskopion automaattituonti epäonnistui (palvelu käynnistyy silti):', e)
  }
  return null
}

export { db }
