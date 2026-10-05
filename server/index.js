import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUserStore } from './users.js'
import { createStore } from './store.js'
import { createAuth } from './auth.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data', 'runtime')

const users = createUserStore(DATA_DIR)
const blobs = createStore(DATA_DIR)
const auth = createAuth({ users })

const BACKUP_KEY = 'site:latest:backup'
const META_KEY = 'site:latest:meta'

function backupMetaFromBody(body, exportedAt) {
  let themes = 0
  let speakers = 0
  let lectures = 0
  let chairpersons = 0
  let readers = 0
  try {
    const parsed = JSON.parse(body)
    themes = parsed.data?.themes?.length ?? 0
    speakers = parsed.data?.speakers?.length ?? 0
    lectures = parsed.data?.lectures?.length ?? 0
    chairpersons = parsed.data?.chairpersons?.length ?? 0
    readers = parsed.data?.readers?.length ?? 0
  } catch {
    /* ignore */
  }
  return {
    ok: true,
    exportedAt,
    themes,
    speakers,
    lectures,
    chairpersons,
    readers,
    bytes: Buffer.byteLength(body, 'utf8'),
  }
}

/** Seed cloud backup from repo JSON when disk is empty (first Render boot). */
async function seedCloudBackupIfEmpty() {
  try {
    const existing = await blobs.get(BACKUP_KEY)
    if (existing) return
    const candidates = [
      path.join(DATA_DIR, 'vuoro-varmuuskopio-slim.json'),
      path.join(ROOT, 'data', 'vuoro-varmuuskopio-slim.json'),
      path.join(ROOT, 'data', 'vuoro-varmuuskopio.json'),
      process.env.BACKUP_FILE || '',
    ].filter(Boolean)
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue
      const body = fs.readFileSync(file, 'utf8')
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        continue
      }
      if (parsed.format !== 'vuoro-backup' || !parsed.data) continue
      if (Array.isArray(parsed.pdfArchives)) {
        parsed.pdfArchives = parsed.pdfArchives.map((p) => ({
          ...p,
          blobBase64: undefined,
        }))
      }
      const exportedAt = parsed.exportedAt ?? new Date().toISOString()
      const seeded = JSON.stringify(parsed)
      const meta = backupMetaFromBody(seeded, exportedAt)
      await blobs.set(BACKUP_KEY, seeded)
      await blobs.set(META_KEY, JSON.stringify(meta))
      console.log(`[vuoro] Seeded cloud backup from ${file}:`, meta)
      return
    }
  } catch (e) {
    console.warn('[vuoro] Seed backup skipped:', e)
  }
}

const app = express()
app.set('trust proxy', 1)
app.use(express.urlencoded({ extended: false, limit: '32kb' }))
app.use(express.json({ limit: '2.5mb' }))

app.get('/__vuoro_login', (req, res) => {
  if (auth.readSession(req)) return res.redirect(303, '/')
  auth.showLogin(req, res)
})
app.post('/__vuoro_login', (req, res) => void auth.handleLoginPost(req, res))
app.get('/__vuoro_logout', (req, res) => auth.handleLogout(req, res))
app.post('/__vuoro_logout', (req, res) => auth.handleLogout(req, res))

// Health check for Render (no auth)
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, auth: auth.authEnabled() })
})

app.use(auth.requireAuth)

app.get('/api/me', (req, res) => {
  if (!auth.authEnabled()) {
    return res.json({ ok: true, auth: false, user: null })
  }
  res.json({
    ok: true,
    auth: true,
    user: req.vuoroUser
      ? {
          id: req.vuoroUser.id,
          username: req.vuoroUser.username,
          role: req.vuoroUser.role,
        }
      : null,
  })
})

app.get('/api/users', auth.requireAdmin, (_req, res) => {
  res.json({ ok: true, users: users.list() })
})

app.post('/api/users', auth.requireAdmin, (req, res) => {
  try {
    const user = users.create({
      username: req.body?.username,
      password: req.body?.password,
      role: req.body?.role === 'admin' ? 'admin' : 'user',
    })
    res.status(201).json({ ok: true, user })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'error'
    const status =
      reason === 'exists' ? 409 : reason === 'bad-username' || reason === 'bad-password' ? 400 : 500
    res.status(status).json({ ok: false, reason })
  }
})

app.put('/api/users/:id/password', auth.requireAdmin, (req, res) => {
  try {
    const user = users.updatePassword(req.params.id, req.body?.password)
    res.json({ ok: true, user })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'error'
    const status = reason === 'missing' ? 404 : reason === 'bad-password' ? 400 : 500
    res.status(status).json({ ok: false, reason })
  }
})

app.delete('/api/users/:id', auth.requireAdmin, (req, res) => {
  try {
    users.remove(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'error'
    const status =
      reason === 'missing' ? 404 : reason === 'last-admin' ? 400 : 500
    res.status(status).json({ ok: false, reason })
  }
})

app.options('/api/cloud-backup', (_req, res) => res.sendStatus(204))
app.options('/api/cloud-backup/meta', (_req, res) => res.sendStatus(204))

app.get('/api/cloud-backup/meta', async (_req, res) => {
  const raw = await blobs.get(META_KEY)
  if (raw == null) return res.status(404).json({ ok: false, reason: 'missing' })
  res.type('json').send(raw)
})

app.get('/api/cloud-backup', async (req, res) => {
  if (req.query.meta === '1') {
    const raw = await blobs.get(META_KEY)
    if (raw == null) return res.status(404).json({ ok: false, reason: 'missing' })
    return res.type('json').send(raw)
  }
  const raw = await blobs.get(BACKUP_KEY)
  if (raw == null) return res.status(404).json({ ok: false, reason: 'missing' })
  res.type('json').send(raw)
})

app.put('/api/cloud-backup', async (req, res) => {
  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
  if (!body || body.length > 2_500_000) {
    return res.status(413).json({ ok: false, reason: 'too-large' })
  }
  let parsed
  try {
    parsed = typeof req.body === 'object' && req.body ? req.body : JSON.parse(body)
  } catch {
    return res.status(400).json({ ok: false, reason: 'invalid-json' })
  }
  if (parsed.format !== 'vuoro-backup' || !parsed.data) {
    return res.status(400).json({ ok: false, reason: 'not-vuoro-backup' })
  }
  const exportedAt = parsed.exportedAt ?? new Date().toISOString()
  const meta = backupMetaFromBody(body, exportedAt)
  await blobs.set(BACKUP_KEY, body)
  await blobs.set(META_KEY, JSON.stringify(meta))
  res.json(meta)
})

app.delete('/api/cloud-backup', async (_req, res) => {
  await blobs.delete(BACKUP_KEY)
  await blobs.delete(META_KEY)
  res.json({ ok: true })
})

app.options('/api/rooms', (_req, res) => res.sendStatus(204))

app.all('/api/rooms', async (req, res) => {
  const roomId = req.query.room
  const key = req.query.key

  // Create a new sync room
  if (req.method === 'POST' && !roomId) {
    const id = blobs.newId()
    await blobs.set(`room:${id}:created`, new Date().toISOString())
    return res.json({ id })
  }

  if (!roomId || !/^[0-9a-f-]{36}$/i.test(String(roomId))) {
    return res.status(400).json({ ok: false, reason: 'bad-room' })
  }
  if (!key || !/^[a-z0-9_-]{1,64}$/i.test(String(key))) {
    return res.status(400).json({ ok: false, reason: 'bad-key' })
  }
  const blobKey = `room:${roomId}:${key}`

  if (req.method === 'GET') {
    const value = await blobs.get(blobKey)
    if (value == null) return res.status(404).json({ ok: false, reason: 'missing' })
    return res.type('json').send(value)
  }
  if (req.method === 'PUT') {
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {})
    if (!body || body.length > 2_500_000) {
      return res.status(413).json({ ok: false, reason: 'too-large' })
    }
    await blobs.set(blobKey, body)
    return res.json({ ok: true })
  }
  if (req.method === 'DELETE') {
    await blobs.delete(blobKey)
    return res.json({ ok: true })
  }
  return res.status(405).json({ ok: false, reason: 'method' })
})

app.use(express.static(DIST, { index: false, maxAge: '1h' }))

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, reason: 'not-found' })
  }
  res.sendFile(path.join(DIST, 'index.html'))
})

const port = Number(process.env.PORT || 10000)
app.listen(port, '0.0.0.0', () => {
  console.log(`[vuoro] listening on :${port} (data=${DATA_DIR}, auth=${auth.authEnabled()})`)
  void seedCloudBackupIfEmpty()
})
