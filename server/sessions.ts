import { db, type OrgRow, type UserRow } from './db.ts'
import { isCoachRole } from './auth.ts'

const ACTIVE_STATUSES = new Set(['booked', 'pending', 'promoted'])

export function bookingCounts(sessionId: string) {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS c FROM bookings WHERE session_id = ? AND status != 'cancelled' GROUP BY status`)
    .all(sessionId) as { status: string; c: number }[]
  let bookedCount = 0
  let waitlistCount = 0
  let pendingCount = 0
  for (const r of rows) {
    if (ACTIVE_STATUSES.has(r.status)) bookedCount += r.c
    if (r.status === 'waitlisted') waitlistCount += r.c
    if (r.status === 'pending') pendingCount += r.c
  }
  return { bookedCount, waitlistCount, pendingCount }
}

export function getOpenSubstitute(sessionId: string) {
  const sub = db
    .prepare(`SELECT * FROM substitutes WHERE session_id = ? AND open = 1 ORDER BY created_at DESC LIMIT 1`)
    .get(sessionId) as
    | { id: string; open: number; reason: string | null; opened_by: string | null; created_at: string }
    | undefined
  if (!sub) return null
  const messages = db
    .prepare(
      `SELECT author_id AS authorId, author_name AS authorName, text, created_at AS createdAt
       FROM substitute_messages WHERE substitute_id = ? ORDER BY created_at ASC`,
    )
    .all(sub.id)
  return {
    id: sub.id,
    open: true,
    reason: sub.reason,
    messages,
  }
}

export function serializeSession(
  row: Record<string, unknown>,
  viewer: UserRow | null,
  opts: { includeRegistrants?: boolean } = {},
) {
  const id = String(row.id)
  const { bookedCount, waitlistCount, pendingCount } = bookingCounts(id)
  const capacity = Number(row.capacity)
  const substitute = getOpenSubstitute(id)
  let myStatus: string | null = null
  let myBookingId: string | null = null
  if (viewer) {
    const mine = db
      .prepare(
        `SELECT id, status FROM bookings WHERE session_id = ? AND user_id = ? AND status != 'cancelled'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(id, viewer.uid) as { id: string; status: string } | undefined
    if (mine) {
      myStatus = mine.status
      myBookingId = mine.id
    }
  }

  const out: Record<string, unknown> = {
    id,
    title: row.title,
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    capacity,
    instructorName: row.instructor_name,
    locationName: row.location_name,
    locationUrl: row.location_url,
    price: row.price,
    seriesId: row.series_id,
    bookedCount,
    waitlistCount,
    pendingCount,
    isFull: bookedCount >= capacity,
    myStatus,
    myBookingId,
    seekingSubstitute: !!substitute,
    substitute,
  }

  if (opts.includeRegistrants && viewer && (isCoachRole(viewer.role) || viewer.role === 'superadmin')) {
    out.registrants = db
      .prepare(
        `SELECT id, name, email, phone, status, source, user_id AS userId, created_at AS createdAt
         FROM bookings WHERE session_id = ? AND status != 'cancelled' ORDER BY created_at ASC`,
      )
      .all(id)
  }

  return out
}

export function listSessions(orgId: string, from: string, to: string, viewer: UserRow | null) {
  const rows = db
    .prepare(
      `SELECT * FROM sessions WHERE org_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at ASC`,
    )
    .all(orgId, from, to) as Record<string, unknown>[]
  return rows.map((r) => serializeSession(r, viewer))
}

export function getOrgBySlug(slug: string) {
  return db.prepare('SELECT * FROM organizations WHERE slug = ?').get(slug) as OrgRow | undefined
}

export function getOrgById(id: string) {
  return db.prepare('SELECT * FROM organizations WHERE id = ?').get(id) as OrgRow | undefined
}

export function promoteWaitlist(sessionId: string): string | null {
  const { bookedCount } = bookingCounts(sessionId)
  const cap = (
    db.prepare('SELECT capacity FROM sessions WHERE id = ?').get(sessionId) as { capacity: number } | undefined
  )?.capacity
  if (cap == null || bookedCount >= cap) return null
  const next = db
    .prepare(
      `SELECT id FROM bookings WHERE session_id = ? AND status = 'waitlisted' ORDER BY created_at ASC LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined
  if (!next) return null
  db.prepare(`UPDATE bookings SET status = 'promoted' WHERE id = ?`).run(next.id)
  return next.id
}
