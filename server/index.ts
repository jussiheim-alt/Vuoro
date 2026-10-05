import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { db, orgPublic, seedIfEmpty, type OrgRow, type UserRow } from './db.ts'
import {
  optionalAuth,
  requireAuth,
  requireUser,
  requireRoles,
  isCoachRole,
} from './auth.ts'
import {
  getOrgById,
  getOrgBySlug,
  listSessions,
  promoteWaitlist,
  serializeSession,
  bookingCounts,
} from './sessions.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT || 8788)

seedIfEmpty()

const app = express()
app.set('trust proxy', 1)
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

const api = express.Router()
api.use(optionalAuth)

function err(res: express.Response, status: number, message: string) {
  res.status(status).json({ error: message })
}

function nowIso() {
  return new Date().toISOString()
}

function userJson(u: UserRow) {
  return { uid: u.uid, name: u.name, email: u.email, phone: u.phone, role: u.role }
}

function activeFrees(status: string) {
  return status === 'booked' || status === 'pending' || status === 'promoted'
}

api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'vuoro',
    authDisabled:
      process.env.AUTH_DISABLED === 'true' || process.env.AUTH_DISABLED === '1',
  })
})

api.get('/public/orgs', (_req, res) => {
  const rows = db
    .prepare(`SELECT * FROM organizations WHERE active = 1 ORDER BY name ASC`)
    .all() as OrgRow[]
  res.json(
    rows.map((o) => ({
      slug: o.slug,
      name: o.name,
      brandColor: o.brand_color,
      logoUrl: o.logo_url,
      active: true,
    })),
  )
})

api.get('/public/orgs/:slug', (req, res) => {
  const o = getOrgBySlug(req.params.slug)
  if (!o || !o.active) return err(res, 404, 'Yritystä ei löydy')
  res.json(orgPublic(o))
})

api.get('/public/orgs/:slug/sessions', (req, res) => {
  const o = getOrgBySlug(req.params.slug)
  if (!o || !o.active) return err(res, 404, 'Yritystä ei löydy')
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!from || !to) return err(res, 400, 'from ja to vaaditaan')
  // Asiakkaat käyttävät tätä endpointtia — välitä viewer jotta myStatus/myBookingId toimii.
  res.json(listSessions(o.id, from, to, req.auth?.user ?? null))
})

api.get('/public/sessions/:id/ics', (req, res) => {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!row) return err(res, 404, 'Treeniä ei löydy')
  const stamp = (iso: unknown) =>
    new Date(String(iso)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Vuoro//FI',
    'BEGIN:VEVENT',
    `UID:${row.id}@vuoro`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(row.starts_at)}`,
    `DTEND:${stamp(row.ends_at)}`,
    `SUMMARY:${String(row.title).replace(/\n/g, ' ')}`,
    row.location_name ? `LOCATION:${String(row.location_name).replace(/\n/g, ' ')}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="vuoro-${row.id}.ics"`)
  res.send(ics)
})

api.post('/register', requireAuth, (req, res) => {
  const uid = req.auth!.uid
  const { name, phone, email, orgSlug, inviteToken } = req.body || {}
  if (!name || !String(name).trim()) return err(res, 400, 'Nimi puuttuu')
  if (!phone || !String(phone).trim()) return err(res, 400, 'Puhelinnumero on pakollinen')
  if (!email || !String(email).includes('@')) return err(res, 400, 'Anna kelvollinen sähköposti')
  const emailNorm = String(email).trim().toLowerCase()
  const superEmail = (process.env.SUPERADMIN_EMAIL || '').trim().toLowerCase()

  const existing = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as UserRow | undefined
  if (existing) {
    db.prepare(`UPDATE users SET name = ?, phone = ?, email = ? WHERE uid = ?`).run(
      String(name).trim(),
      String(phone).trim(),
      emailNorm,
      uid,
    )
    if (superEmail && emailNorm === superEmail && existing.role !== 'superadmin') {
      db.prepare(`UPDATE users SET role = 'superadmin', org_id = NULL WHERE uid = ?`).run(uid)
    }
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as UserRow
    const org = user.org_id ? getOrgById(user.org_id) : null
    return res.json({ user: userJson(user), organization: org ? orgPublic(org) : null })
  }

  let role = 'customer'
  let orgId: string | null = null
  if (superEmail && emailNorm === superEmail) {
    role = 'superadmin'
    orgId = null
  } else if (inviteToken) {
    const inv = db
      .prepare(`SELECT * FROM invitations WHERE token = ? AND accepted_at IS NULL`)
      .get(inviteToken) as { id: string; org_id: string; role: string } | undefined
    if (!inv) return err(res, 400, 'Kutsu ei ole voimassa')
    role = inv.role
    orgId = inv.org_id
    db.prepare(`UPDATE invitations SET accepted_at = ? WHERE id = ?`).run(nowIso(), inv.id)
  } else if (orgSlug) {
    const o = getOrgBySlug(String(orgSlug))
    if (!o || !o.active) return err(res, 400, 'Yritystä ei löydy')
    orgId = o.id
  } else {
    return err(res, 400, 'orgSlug tai inviteToken vaaditaan')
  }

  db.prepare(
    `INSERT INTO users (uid, email, name, phone, role, org_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(uid, emailNorm, String(name).trim(), String(phone).trim(), role, orgId, nowIso())
  const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as UserRow
  const org = user.org_id ? getOrgById(user.org_id) : null
  res.status(201).json({ user: userJson(user), organization: org ? orgPublic(org) : null })
})

api.get('/me', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const org = user.org_id ? getOrgById(user.org_id) : null
  res.json({ user: userJson(user), organization: org ? orgPublic(org) : null })
})

api.get('/sessions', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const from = String(req.query.from || '')
  const to = String(req.query.to || '')
  if (!from || !to) return err(res, 400, 'from ja to vaaditaan')
  if (user.role === 'superadmin') {
    const orgs = db.prepare(`SELECT id FROM organizations WHERE active = 1`).all() as { id: string }[]
    const all = orgs.flatMap((o) => listSessions(o.id, from, to, user))
    all.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
    return res.json(all)
  }
  if (!user.org_id) return err(res, 400, 'Ei organisaatiota')
  res.json(listSessions(user.org_id, from, to, user))
})

api.get('/sessions/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!row) return err(res, 404, 'Treeniä ei löydy')
  if (user.role !== 'superadmin' && row.org_id !== user.org_id) return err(res, 403, 'Ei oikeuksia')
  res.json(serializeSession(row, user, { includeRegistrants: true }))
})

api.post('/sessions', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const orgId = user.org_id
  if (!orgId) return err(res, 400, 'Ei organisaatiota')
  const {
    title,
    startsAt,
    endsAt,
    capacity,
    instructorName,
    locationName,
    description,
    locationUrl,
    price,
    repeatWeekly,
    repeatDays,
  } = req.body || {}
  if (!title || !startsAt || !endsAt) return err(res, 400, 'title, startsAt ja endsAt vaaditaan')
  const weeks = Math.max(1, Number(repeatWeekly) || 1)
  const days: number[] =
    Array.isArray(repeatDays) && repeatDays.length
      ? repeatDays.map(Number)
      : [(new Date(startsAt).getDay() + 6) % 7]
  const durationMs = new Date(endsAt).getTime() - new Date(startsAt).getTime()
  const base = new Date(startsAt)
  const seriesId = weeks > 1 || days.length > 1 ? crypto.randomUUID() : null
  const created: string[] = []
  const ins = db.prepare(
    `INSERT INTO sessions (id, org_id, series_id, title, description, starts_at, ends_at, capacity,
      instructor_name, location_name, location_url, price, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const startDow = (base.getDay() + 6) % 7
  for (let w = 0; w < weeks; w++) {
    for (const d of days) {
      const start = new Date(base)
      start.setDate(base.getDate() + w * 7 + (d - startDow))
      const end = new Date(start.getTime() + durationMs)
      const id = crypto.randomUUID()
      ins.run(
        id,
        orgId,
        seriesId,
        String(title).trim(),
        description || null,
        start.toISOString(),
        end.toISOString(),
        Number(capacity) || 10,
        instructorName || null,
        locationName || null,
        locationUrl || null,
        price || null,
        user.uid,
        nowIso(),
      )
      created.push(id)
    }
  }
  if (seriesId) return res.status(201).json({ seriesId, count: created.length })
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(created[0]) as Record<string, unknown>
  res.status(201).json(serializeSession(row, user, { includeRegistrants: true }))
})

api.put('/sessions/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!row) return err(res, 404, 'Treeniä ei löydy')
  if (user.role !== 'superadmin' && row.org_id !== user.org_id) return err(res, 403, 'Ei oikeuksia')
  const b = req.body || {}
  db.prepare(
    `UPDATE sessions SET title = COALESCE(?, title), description = COALESCE(?, description),
      starts_at = COALESCE(?, starts_at), ends_at = COALESCE(?, ends_at), capacity = COALESCE(?, capacity),
      instructor_name = COALESCE(?, instructor_name), location_name = COALESCE(?, location_name),
      location_url = COALESCE(?, location_url), price = COALESCE(?, price) WHERE id = ?`,
  ).run(
    b.title ?? null,
    b.description ?? null,
    b.startsAt ?? null,
    b.endsAt ?? null,
    b.capacity ?? null,
    b.instructorName ?? null,
    b.locationName ?? null,
    b.locationUrl ?? null,
    b.price ?? null,
    req.params.id,
  )
  const updated = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as Record<
    string,
    unknown
  >
  res.json(serializeSession(updated, user, { includeRegistrants: true }))
})

api.delete('/sessions/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!row) return err(res, 404, 'Treeniä ei löydy')
  if (user.role !== 'superadmin' && row.org_id !== user.org_id) return err(res, 403, 'Ei oikeuksia')
  const scope = String(req.query.scope || '')
  if (scope === 'series' && row.series_id) {
    const result = db
      .prepare(`DELETE FROM sessions WHERE series_id = ? AND starts_at >= ?`)
      .run(row.series_id, row.starts_at)
    return res.json({ deleted: result.changes })
  }
  db.prepare(`DELETE FROM sessions WHERE id = ?`).run(req.params.id)
  res.json({ deleted: 1 })
})

api.get('/pending', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const rows = db
    .prepare(
      `SELECT b.id AS bookingId, b.name, b.phone, b.email, s.title, s.starts_at AS startsAt
       FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.status = 'pending' AND (${user.role === 'superadmin' ? '1=1' : 's.org_id = ?'})
       ORDER BY s.starts_at ASC`,
    )
    .all(...(user.role === 'superadmin' ? [] : [user.org_id])) as Array<{
    bookingId: string
    name: string
    phone: string | null
    email: string | null
    title: string
    startsAt: string
  }>
  res.json(
    rows.map((r) => ({
      bookingId: r.bookingId,
      name: r.name,
      phone: r.phone,
      email: r.email,
      session: { title: r.title, startsAt: r.startsAt },
    })),
  )
})

api.post('/sessions/:id/bookings', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!session) return err(res, 404, 'Treeniä ei löydy')
  if (user.role !== 'superadmin' && session.org_id !== user.org_id) return err(res, 403, 'Ei oikeuksia')
  const body = req.body || {}
  const coachAdd = isCoachRole(user.role) && (body.name || body.phone || body.email)
  const { bookedCount } = bookingCounts(String(session.id))
  const capacity = Number(session.capacity)

  if (coachAdd) {
    const id = crypto.randomUUID()
    db.prepare(
      `INSERT INTO bookings (id, session_id, user_id, name, email, phone, status, source, created_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'booked', 'coach', ?)`,
    ).run(id, session.id, String(body.name).trim(), body.email || null, body.phone || null, nowIso())
    return res.status(201).json({ id, status: 'booked', source: 'coach' })
  }

  const existing = db
    .prepare(
      `SELECT id FROM bookings WHERE session_id = ? AND user_id = ? AND status != 'cancelled' LIMIT 1`,
    )
    .get(session.id, user.uid)
  if (existing) return err(res, 409, 'Olet jo ilmoittautunut')

  const status = bookedCount >= capacity ? 'waitlisted' : 'pending'
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO bookings (id, session_id, user_id, name, email, phone, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'self', ?)`,
  ).run(id, session.id, user.uid, user.name, user.email, user.phone, status, nowIso())
  res.status(201).json({ id, bookingId: id, status, source: 'self' })
})

api.delete('/bookings/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const b = db
    .prepare(
      `SELECT b.*, s.org_id, s.starts_at, s.id AS sid FROM bookings b
       JOIN sessions s ON s.id = b.session_id WHERE b.id = ?`,
    )
    .get(req.params.id) as
    | {
        id: string
        user_id: string | null
        status: string
        org_id: string
        starts_at: string
        sid: string
      }
    | undefined
  if (!b) return err(res, 404, 'Varausta ei löydy')
  const coach = isCoachRole(user.role) || user.role === 'superadmin'
  if (!coach && b.user_id !== user.uid) return err(res, 403, 'Ei oikeuksia')
  // Jonosta voi poistua aina; muuten cancelCutoffHours rajoittaa asiakasta.
  if (!coach && b.status !== 'waitlisted') {
    const org = getOrgById(b.org_id)
    const cutoff = org?.cancel_cutoff_hours ?? 0
    if (cutoff > 0) {
      const hours = (new Date(b.starts_at).getTime() - Date.now()) / 3600000
      if (hours < cutoff) return err(res, 400, `Peruutus ei onnistu alle ${cutoff} h ennen alkua`)
    }
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?`).run(b.id)
  if (activeFrees(b.status)) promoteWaitlist(b.sid)
  res.status(204).end()
})

api.patch('/bookings/:id/approve', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const b = db
    .prepare(
      `SELECT b.*, s.org_id FROM bookings b JOIN sessions s ON s.id = b.session_id WHERE b.id = ?`,
    )
    .get(req.params.id) as { id: string; status: string; org_id: string } | undefined
  if (!b) return err(res, 404, 'Varausta ei löydy')
  if (user.role !== 'superadmin' && b.org_id !== user.org_id) return err(res, 403, 'Ei oikeuksia')
  if (b.status !== 'pending') return err(res, 400, 'Varaus ei odota hyväksyntää')
  db.prepare(`UPDATE bookings SET status = 'booked' WHERE id = ?`).run(b.id)
  res.json({ id: b.id, status: 'booked' })
})

api.patch('/bookings/:id/confirm', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const b = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(req.params.id) as
    | { id: string; status: string; user_id: string | null }
    | undefined
  if (!b) return err(res, 404, 'Varausta ei löydy')
  if (b.user_id !== user.uid && !isCoachRole(user.role) && user.role !== 'superadmin') {
    return err(res, 403, 'Ei oikeuksia')
  }
  if (b.status !== 'promoted') return err(res, 400, 'Varaus ei odota vahvistusta')
  db.prepare(`UPDATE bookings SET status = 'booked' WHERE id = ?`).run(b.id)
  res.json({ id: b.id, status: 'booked' })
})

api.post('/sessions/:id/substitute', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!session) return err(res, 404, 'Treeniä ei löydy')
  const id = crypto.randomUUID()
  const reason = String(req.body?.reason || '').trim() || null
  db.prepare(
    `INSERT INTO substitutes (id, session_id, open, reason, opened_by, created_at) VALUES (?, ?, 1, ?, ?, ?)`,
  ).run(id, session.id, reason, user.uid, nowIso())
  db.prepare(
    `INSERT INTO substitute_messages (id, substitute_id, author_id, author_name, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(crypto.randomUUID(), id, user.uid, user.name, `${user.name} avasi sijaisuuspyynnön`, nowIso())
  res.status(201).json({ id, open: true, reason })
})

api.patch('/substitute/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!isCoachRole(user.role) && user.role !== 'superadmin') return err(res, 403, 'Ei oikeuksia')
  if (req.body?.open === false) {
    db.prepare(`UPDATE substitutes SET open = 0 WHERE id = ?`).run(req.params.id)
  }
  res.json({ id: req.params.id, open: false })
})

api.post('/substitute/:id/messages', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const text = String(req.body?.text || '').trim()
  if (!text) return err(res, 400, 'Viesti puuttuu')
  const sub = db.prepare(`SELECT * FROM substitutes WHERE id = ? AND open = 1`).get(req.params.id)
  if (!sub) return err(res, 404, 'Sijaisuuspyyntöä ei löydy')
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO substitute_messages (id, substitute_id, author_id, author_name, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, req.params.id, user.uid, user.name, text, nowIso())
  res.status(201).json({ id, text })
})

api.get('/spot-requests', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  if (!user.org_id && user.role !== 'superadmin') return res.json([])
  const rows = db
    .prepare(
      `SELECT r.*, s.title, s.starts_at, s.ends_at, s.instructor_name, s.location_name
       FROM spot_requests r JOIN sessions s ON s.id = r.session_id
       WHERE r.open = 1 AND (${user.role === 'superadmin' ? '1=1' : 's.org_id = ?'})
       ORDER BY s.starts_at ASC`,
    )
    .all(...(user.role === 'superadmin' ? [] : [user.org_id])) as Record<string, unknown>[]
  res.json(
    rows.map((r) => ({
      id: r.id,
      requesterId: r.requester_id,
      requesterName: r.requester_name,
      message: r.message,
      session: {
        id: r.session_id,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        instructorName: r.instructor_name,
        locationName: r.location_name,
      },
    })),
  )
})

api.get('/spot-requests/:id', requireAuth, requireUser, (req, res) => {
  const r = db
    .prepare(
      `SELECT r.*, s.title, s.starts_at, s.ends_at, s.instructor_name, s.location_name, s.id AS sid
       FROM spot_requests r JOIN sessions s ON s.id = r.session_id WHERE r.id = ?`,
    )
    .get(req.params.id) as Record<string, unknown> | undefined
  if (!r) return err(res, 404, 'Sijaispyyntöä ei löydy')
  const messages = db
    .prepare(
      `SELECT author_id AS authorId, author_name AS authorName, text, created_at AS createdAt
       FROM spot_messages WHERE spot_request_id = ? ORDER BY created_at ASC`,
    )
    .all(req.params.id)
  res.json({
    id: r.id,
    requesterId: r.requester_id,
    requesterName: r.requester_name,
    message: r.message,
    messages,
    session: {
      id: r.sid,
      title: r.title,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      instructorName: r.instructor_name,
      locationName: r.location_name,
    },
  })
})

api.post('/sessions/:id/spot-request', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id) as
    | Record<string, unknown>
    | undefined
  if (!session) return err(res, 404, 'Treeniä ei löydy')
  const id = crypto.randomUUID()
  const message = String(req.body?.message || '').trim() || null
  db.prepare(
    `INSERT INTO spot_requests (id, session_id, requester_id, requester_name, message, open, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  ).run(id, session.id, user.uid, user.name, message, nowIso())
  res.status(201).json({ id })
})

api.post('/spot-requests/:id/messages', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const text = String(req.body?.text || '').trim()
  if (!text) return err(res, 400, 'Viesti puuttuu')
  const r = db.prepare(`SELECT * FROM spot_requests WHERE id = ? AND open = 1`).get(req.params.id)
  if (!r) return err(res, 404, 'Sijaispyyntöä ei löydy')
  const id = crypto.randomUUID()
  db.prepare(
    `INSERT INTO spot_messages (id, spot_request_id, author_id, author_name, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, req.params.id, user.uid, user.name, text, nowIso())
  res.status(201).json({ id })
})

api.patch('/spot-requests/:id', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const r = db.prepare(`SELECT * FROM spot_requests WHERE id = ?`).get(req.params.id) as
    | { id: string; requester_id: string }
    | undefined
  if (!r) return err(res, 404, 'Sijaispyyntöä ei löydy')
  if (r.requester_id !== user.uid && !isCoachRole(user.role) && user.role !== 'superadmin') {
    return err(res, 403, 'Ei oikeuksia')
  }
  db.prepare(`UPDATE spot_requests SET open = 0 WHERE id = ?`).run(r.id)
  res.json({ id: r.id, open: false })
})

function teamPayload(orgId: string) {
  const members = db
    .prepare(
      `SELECT uid AS id, name, email, phone, role FROM users
       WHERE org_id = ? AND active = 1 AND role IN ('owner','coach') ORDER BY name`,
    )
    .all(orgId)
  const invitations = db
    .prepare(
      `SELECT id, email, role, token FROM invitations WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`,
    )
    .all(orgId)
  return { members, invitations }
}

api.get('/invite/:token', (req, res) => {
  const inv = db
    .prepare(`SELECT * FROM invitations WHERE token = ? AND accepted_at IS NULL`)
    .get(req.params.token) as { email: string; role: string; org_id: string } | undefined
  if (!inv) return err(res, 404, 'Kutsu ei ole voimassa')
  const org = getOrgById(inv.org_id)
  if (!org) return err(res, 404, 'Kutsu ei ole voimassa')
  res.json({ email: inv.email, role: inv.role, organization: { slug: org.slug, name: org.name } })
})

api.get('/team', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  if (!user.org_id) return err(res, 400, 'Ei organisaatiota')
  res.json(teamPayload(user.org_id))
})

api.post('/invitations', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  if (!user.org_id) return err(res, 400, 'Ei organisaatiota')
  const email = String(req.body?.email || '').trim().toLowerCase()
  const role = String(req.body?.role || 'coach')
  if (!email.includes('@')) return err(res, 400, 'Anna kelvollinen sähköposti')
  if (!['coach', 'owner'].includes(role)) return err(res, 400, 'Virheellinen rooli')
  const id = crypto.randomUUID()
  const token = crypto.randomUUID().replace(/-/g, '')
  db.prepare(
    `INSERT INTO invitations (id, org_id, email, role, token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, user.org_id, email, role, token, user.uid, nowIso())
  res.status(201).json({ id, email, role, token })
})

api.delete('/invitations/:id', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  const inv = db.prepare(`SELECT * FROM invitations WHERE id = ?`).get(req.params.id) as
    | { org_id: string }
    | undefined
  if (!inv || inv.org_id !== user.org_id) return err(res, 404, 'Kutsua ei löydy')
  db.prepare(`DELETE FROM invitations WHERE id = ?`).run(req.params.id)
  res.status(204).end()
})

api.put('/members/:id/role', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  const role = String(req.body?.role || '')
  if (!['coach', 'owner'].includes(role)) return err(res, 400, 'Virheellinen rooli')
  const m = db.prepare(`SELECT * FROM users WHERE uid = ?`).get(req.params.id) as UserRow | undefined
  if (!m || m.org_id !== user.org_id) return err(res, 404, 'Jäsentä ei löydy')
  db.prepare(`UPDATE users SET role = ? WHERE uid = ?`).run(role, m.uid)
  res.json({ id: m.uid, role })
})

api.delete('/members/:id', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  const m = db.prepare(`SELECT * FROM users WHERE uid = ?`).get(req.params.id) as UserRow | undefined
  if (!m || m.org_id !== user.org_id) return err(res, 404, 'Jäsentä ei löydy')
  if (m.uid === user.uid) return err(res, 400, 'Et voi poistaa itseäsi')
  db.prepare(`UPDATE users SET active = 0 WHERE uid = ?`).run(m.uid)
  res.status(204).end()
})

api.put('/org/settings', requireAuth, requireUser, requireRoles('owner'), (req, res) => {
  const user = req.auth!.user!
  if (!user.org_id) return err(res, 400, 'Ei organisaatiota')
  const b = req.body || {}
  if (typeof b.cancelCutoffHours === 'number') {
    db.prepare(`UPDATE organizations SET cancel_cutoff_hours = ? WHERE id = ?`).run(
      b.cancelCutoffHours,
      user.org_id,
    )
  }
  if (b.emailFrom !== undefined) {
    db.prepare(`UPDATE organizations SET email_from = ? WHERE id = ?`).run(b.emailFrom, user.org_id)
  }
  if (b.replyTo !== undefined) {
    db.prepare(`UPDATE organizations SET reply_to = ? WHERE id = ?`).run(b.replyTo, user.org_id)
  }
  if (b.brandColor) {
    db.prepare(`UPDATE organizations SET brand_color = ? WHERE id = ?`).run(b.brandColor, user.org_id)
  }
  if (b.logoUrl === null) {
    db.prepare(`UPDATE organizations SET logo_url = NULL WHERE id = ?`).run(user.org_id)
  } else if (typeof b.logoUrl === 'string') {
    db.prepare(`UPDATE organizations SET logo_url = ? WHERE id = ?`).run(b.logoUrl, user.org_id)
  }
  res.json(orgPublic(getOrgById(user.org_id)!))
})

api.get('/my/bookings', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const rows = db
    .prepare(
      `SELECT b.id AS bookingId, b.status, s.id AS sid, s.title, s.starts_at, s.ends_at,
              s.instructor_name, s.location_name, s.location_url, s.price
       FROM bookings b JOIN sessions s ON s.id = b.session_id
       WHERE b.user_id = ? AND b.status != 'cancelled' ORDER BY s.starts_at ASC`,
    )
    .all(user.uid) as Record<string, unknown>[]
  res.json(
    rows.map((r) => ({
      bookingId: r.bookingId,
      status: r.status,
      session: {
        id: r.sid,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        instructorName: r.instructor_name,
        locationName: r.location_name,
        locationUrl: r.location_url,
        price: r.price,
      },
    })),
  )
})

api.get('/my/data', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  const bookings = db.prepare(`SELECT * FROM bookings WHERE user_id = ?`).all(user.uid)
  res.json({ user: userJson(user), bookings, exportedAt: nowIso() })
})

api.delete('/my/account', requireAuth, requireUser, (req, res) => {
  const user = req.auth!.user!
  db.prepare(`UPDATE bookings SET user_id = NULL WHERE user_id = ?`).run(user.uid)
  db.prepare(`DELETE FROM users WHERE uid = ?`).run(user.uid)
  res.status(204).end()
})

api.get('/admin/orgs', requireAuth, requireUser, requireRoles('superadmin'), (_req, res) => {
  const rows = db.prepare(`SELECT * FROM organizations ORDER BY name`).all() as OrgRow[]
  res.json(
    rows.map((o) => {
      const users = (
        db.prepare(`SELECT COUNT(*) AS c FROM users WHERE org_id = ? AND active = 1`).get(o.id) as {
          c: number
        }
      ).c
      const sessions = (
        db.prepare(`SELECT COUNT(*) AS c FROM sessions WHERE org_id = ?`).get(o.id) as { c: number }
      ).c
      return { id: o.id, slug: o.slug, name: o.name, active: o.active !== 0, users, sessions }
    }),
  )
})

api.post('/admin/orgs', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  const slug = String(req.body?.slug || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
  const name = String(req.body?.name || '').trim()
  if (!slug || !name) return err(res, 400, 'Anna slug ja nimi')
  const id = crypto.randomUUID()
  try {
    db.prepare(
      `INSERT INTO organizations (id, slug, name, brand_color, cancel_cutoff_hours, active, created_at)
       VALUES (?, ?, ?, '#3b5bdb', 0, 1, ?)`,
    ).run(id, slug, name, nowIso())
  } catch {
    return err(res, 409, 'Slug on jo käytössä')
  }
  res.status(201).json({ id, slug, name })
})

api.post(
  '/admin/orgs/:id/invite-owner',
  requireAuth,
  requireUser,
  requireRoles('superadmin'),
  (req, res) => {
    const org = getOrgById(req.params.id)
    if (!org) return err(res, 404, 'Yritystä ei löydy')
    const email = String(req.body?.email || '').trim().toLowerCase()
    if (!email.includes('@')) return err(res, 400, 'Anna kelvollinen sähköposti')
    const id = crypto.randomUUID()
    const token = crypto.randomUUID().replace(/-/g, '')
    db.prepare(
      `INSERT INTO invitations (id, org_id, email, role, token, created_by, created_at) VALUES (?, ?, ?, 'owner', ?, ?, ?)`,
    ).run(id, org.id, email, token, req.auth!.user!.uid, nowIso())
    res.status(201).json({ id, email, role: 'owner', token })
  },
)

api.get('/admin/orgs/:id/team', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  const org = getOrgById(req.params.id)
  if (!org) return err(res, 404, 'Yritystä ei löydy')
  const team = teamPayload(org.id)
  res.json({ org: orgPublic(org), members: team.members, invitations: team.invitations })
})

api.post(
  '/admin/orgs/:id/invitations',
  requireAuth,
  requireUser,
  requireRoles('superadmin'),
  (req, res) => {
    const org = getOrgById(req.params.id)
    if (!org) return err(res, 404, 'Yritystä ei löydy')
    const email = String(req.body?.email || '').trim().toLowerCase()
    const role = String(req.body?.role || 'coach')
    if (!email.includes('@')) return err(res, 400, 'Anna kelvollinen sähköposti')
    const id = crypto.randomUUID()
    const token = crypto.randomUUID().replace(/-/g, '')
    db.prepare(
      `INSERT INTO invitations (id, org_id, email, role, token, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, org.id, email, role, token, req.auth!.user!.uid, nowIso())
    res.status(201).json({ id, email, role, token })
  },
)

api.delete('/admin/invitations/:id', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  db.prepare(`DELETE FROM invitations WHERE id = ?`).run(req.params.id)
  res.status(204).end()
})

api.put('/admin/members/:id/role', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  const role = String(req.body?.role || '')
  if (!['coach', 'owner', 'customer', 'superadmin'].includes(role)) {
    return err(res, 400, 'Virheellinen rooli')
  }
  db.prepare(`UPDATE users SET role = ? WHERE uid = ?`).run(role, req.params.id)
  res.json({ id: req.params.id, role })
})

api.delete('/admin/members/:id', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  db.prepare(`UPDATE users SET active = 0 WHERE uid = ?`).run(req.params.id)
  res.status(204).end()
})

api.put('/admin/orgs/:id/settings', requireAuth, requireUser, requireRoles('superadmin'), (req, res) => {
  const org = getOrgById(req.params.id)
  if (!org) return err(res, 404, 'Yritystä ei löydy')
  const b = req.body || {}
  if (typeof b.cancelCutoffHours === 'number') {
    db.prepare(`UPDATE organizations SET cancel_cutoff_hours = ? WHERE id = ?`).run(
      b.cancelCutoffHours,
      org.id,
    )
  }
  if (b.emailFrom !== undefined) {
    db.prepare(`UPDATE organizations SET email_from = ? WHERE id = ?`).run(b.emailFrom, org.id)
  }
  if (b.replyTo !== undefined) {
    db.prepare(`UPDATE organizations SET reply_to = ? WHERE id = ?`).run(b.replyTo, org.id)
  }
  if (b.brandColor) {
    db.prepare(`UPDATE organizations SET brand_color = ? WHERE id = ?`).run(b.brandColor, org.id)
  }
  if (b.logoUrl === null) db.prepare(`UPDATE organizations SET logo_url = NULL WHERE id = ?`).run(org.id)
  else if (typeof b.logoUrl === 'string') {
    db.prepare(`UPDATE organizations SET logo_url = ? WHERE id = ?`).run(b.logoUrl, org.id)
  }
  if (typeof b.active === 'boolean') {
    db.prepare(`UPDATE organizations SET active = ? WHERE id = ?`).run(b.active ? 1 : 0, org.id)
  }
  res.json(orgPublic(getOrgById(org.id)!))
})

app.use('/api', api)
app.use(express.static(publicDir))
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(publicDir, 'index.html'))
})

app.listen(PORT, () => {
  console.log(`Vuoro kuuntelee portissa ${PORT}`)
  console.log(
    `DATA_DIR=${process.env.DATA_DIR || './data'} AUTH_DISABLED=${process.env.AUTH_DISABLED || 'false'}`,
  )
})
