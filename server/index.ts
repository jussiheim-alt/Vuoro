import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import {
  db,
  ensureAdminUser,
  autoImportBackupIfEmpty,
  importBackup,
  exportBackup,
  type VuoroBackup,
} from './db.ts'
import {
  loginHandler,
  logoutHandler,
  requireAuth,
  requireAdmin,
  readUserFromRequest,
  type AuthedRequest,
} from './auth.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT || 8788)

ensureAdminUser()
autoImportBackupIfEmpty()

const app = express()
app.set('trust proxy', 1)
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '40mb' }))
app.use(cookieParser())

const api = express.Router()

api.get('/health', (_req, res) => {
  const lectures = (db.prepare('SELECT COUNT(*) AS c FROM lectures').get() as { c: number }).c
  res.json({ ok: true, service: 'vuoro-esitelmat', lectures })
})

api.post('/login', loginHandler)
api.post('/logout', logoutHandler)

api.get('/me', async (req, res) => {
  const user = await readUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Ei kirjautunut' })
    return
  }
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } })
})

api.use(requireAuth)

api.get('/bootstrap', (_req, res) => {
  const themes = db.prepare('SELECT * FROM themes ORDER BY CAST(number AS INTEGER), name').all()
  const speakers = db.prepare('SELECT * FROM speakers ORDER BY name COLLATE NOCASE').all()
  const chairpersons = db.prepare('SELECT * FROM chairpersons ORDER BY name COLLATE NOCASE').all()
  const readers = db.prepare('SELECT * FROM readers ORDER BY name COLLATE NOCASE').all()
  const lectures = db.prepare('SELECT * FROM lectures ORDER BY date ASC').all()
  const settingsRows = db.prepare('SELECT key, value_json FROM settings').all() as {
    key: string
    value_json: string
  }[]
  const settings: Record<string, unknown> = {}
  for (const r of settingsRows) settings[r.key] = JSON.parse(r.value_json)
  const pdfArchives = db
    .prepare(
      `SELECT id, created_at AS createdAt, kind, filename, from_date AS fromDate, to_date AS toDate,
              entry_count AS entryCount, mime_type AS mimeType
       FROM pdf_archives ORDER BY created_at DESC`,
    )
    .all()

  res.json({
    themes: themes.map(mapTheme),
    speakers: speakers.map(mapSpeaker),
    chairpersons: chairpersons.map(mapChair),
    readers: readers.map(mapReader),
    lectures: lectures.map(mapLecture),
    settings,
    pdfArchives,
  })
})

function mapTheme(t: any) {
  return {
    id: t.id,
    number: t.number,
    name: t.name,
    notes: t.notes,
    disabled: !!t.disabled,
    lastUsedAt: t.last_used_at,
  }
}
function mapSpeaker(s: any) {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone,
    congregation: s.congregation,
    outlines: JSON.parse(s.outlines_json || '[]'),
    notes: s.notes,
    localOnly: !!s.local_only,
    assistant: !!s.assistant,
    lastUsedAt: s.last_used_at,
    snoozeUntil: s.snooze_until,
    unavailable: !!s.unavailable,
    unavailableReason: s.unavailable_reason,
  }
}
function mapChair(c: any) {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    notes: c.notes,
    lastUsedAt: c.last_used_at,
    alsoReads: !!c.also_reads,
  }
}
function mapReader(r: any) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    notes: r.notes,
    lastUsedAt: r.last_used_at,
    alsoReads: !!r.also_reads,
  }
}
function mapLecture(l: any) {
  return {
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
  }
}

api.put('/lectures/:id', (req, res) => {
  const id = req.params.id
  const existing = db.prepare('SELECT * FROM lectures WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!existing) {
    res.status(404).json({ error: 'Esitelmää ei löydy' })
    return
  }
  const b = req.body || {}
  db.prepare(
    `UPDATE lectures SET
      date = ?, theme_id = ?, speaker_id = ?, chairperson_id = ?, reader_id = ?,
      status = ?, notes = ?, event_kind = ?, custom_title = ?
     WHERE id = ?`,
  ).run(
    b.date !== undefined ? b.date : existing.date,
    b.themeId !== undefined ? b.themeId : existing.theme_id,
    b.speakerId !== undefined ? b.speakerId : existing.speaker_id,
    b.chairpersonId !== undefined ? b.chairpersonId : existing.chairperson_id,
    b.readerId !== undefined ? b.readerId : existing.reader_id,
    b.status !== undefined ? b.status : existing.status,
    b.notes !== undefined ? b.notes : existing.notes,
    b.eventKind !== undefined ? b.eventKind : existing.event_kind,
    b.customTitle !== undefined ? b.customTitle : existing.custom_title,
    id,
  )
  res.json(mapLecture(db.prepare('SELECT * FROM lectures WHERE id = ?').get(id)))
})

api.post('/lectures', (req, res) => {
  const b = req.body || {}
  if (!b.date) {
    res.status(400).json({ error: 'Päivä puuttuu' })
    return
  }
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO lectures (id, date, theme_id, speaker_id, chairperson_id, reader_id, status, created_at, notes, event_kind, custom_title)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    b.date,
    b.themeId || null,
    b.speakerId || null,
    b.chairpersonId || null,
    b.readerId || null,
    b.status || 'planned',
    new Date().toISOString(),
    b.notes || '',
    b.eventKind || 'talk',
    b.customTitle || '',
  )
  res.status(201).json(mapLecture(db.prepare('SELECT * FROM lectures WHERE id = ?').get(id)))
})

api.delete('/lectures/:id', (req, res) => {
  db.prepare('DELETE FROM lectures WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

api.put('/settings', (req, res) => {
  const body = req.body || {}
  for (const [key, value] of Object.entries(body)) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)').run(
      key,
      JSON.stringify(value),
    )
  }
  res.json({ ok: true })
})

api.get('/backup/export', (_req, res) => {
  const backup = exportBackup()
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="vuoro-varmuuskopio_${new Date().toISOString().slice(0, 10)}.json"`,
  )
  res.send(JSON.stringify(backup))
})

api.post('/backup/import', requireAdmin, (req, res) => {
  try {
    const backup = req.body as VuoroBackup
    const stats = importBackup(backup, { replace: true })
    res.json({ ok: true, stats })
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Tuonti epäonnistui' })
  }
})

api.get('/pdf-archives/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM pdf_archives WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!row || !row.blob_base64) {
    res.status(404).json({ error: 'PDF:ää ei löydy' })
    return
  }
  const buf = Buffer.from(String(row.blob_base64), 'base64')
  res.setHeader('Content-Type', String(row.mime_type || 'application/pdf'))
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename || 'vuoro.pdf'}"`)
  res.send(buf)
})

api.get('/users', requireAdmin, (_req, res) => {
  const users = db
    .prepare('SELECT id, username, name, role, active, created_at AS createdAt FROM users ORDER BY username')
    .all()
  res.json(users)
})

api.post('/users', requireAdmin, (req, res) => {
  const username = String(req.body?.username || '').trim()
  const name = String(req.body?.name || username).trim()
  const password = String(req.body?.password || '')
  const role = String(req.body?.role || 'editor')
  if (!username || password.length < 6) {
    res.status(400).json({ error: 'Tunnus ja salasana (min. 6) vaaditaan' })
    return
  }
  try {
    const id = crypto.randomUUID()
    db.prepare(
      `INSERT INTO users (id, username, name, password_hash, role, active, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
    ).run(id, username, name, bcrypt.hashSync(password, 10), role, new Date().toISOString())
    res.status(201).json({ id, username, name, role })
  } catch {
    res.status(409).json({ error: 'Tunnus on jo käytössä' })
  }
})

app.use('/api', api)
app.use(express.static(publicDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Vuoro (esitelmät) portissa ${PORT}`)
})
