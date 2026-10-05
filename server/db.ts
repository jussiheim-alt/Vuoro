import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import path from 'node:path'
import { dataDir, ensureDataDir } from './paths.ts'

export const dbPath = path.join(dataDir, 'vuoro.sqlite')

ensureDataDir()

const db = new Database(dbPath)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand_color TEXT DEFAULT '#3b5bdb',
  logo_url TEXT,
  cancel_cutoff_hours INTEGER DEFAULT 0,
  email_from TEXT,
  reply_to TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL,
  org_id TEXT REFERENCES organizations(id),
  active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id),
  series_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  instructor_name TEXT,
  location_name TEXT,
  location_url TEXT,
  price TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'self',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS substitutes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  open INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  opened_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS substitute_messages (
  id TEXT PRIMARY KEY,
  substitute_id TEXT NOT NULL REFERENCES substitutes(id) ON DELETE CASCADE,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spot_requests (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  message TEXT,
  open INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS spot_messages (
  id TEXT PRIMARY KEY,
  spot_request_id TEXT NOT NULL REFERENCES spot_requests(id) ON DELETE CASCADE,
  author_id TEXT,
  author_name TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_org_time ON sessions(org_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_bookings_session ON bookings(session_id);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`)

export type OrgRow = {
  id: string
  slug: string
  name: string
  brand_color: string | null
  logo_url: string | null
  cancel_cutoff_hours: number
  email_from: string | null
  reply_to: string | null
  active: number
  created_at: string
}

export type UserRow = {
  uid: string
  email: string
  name: string
  phone: string | null
  role: string
  org_id: string | null
  active: number
  created_at: string
}

export function orgPublic(o: OrgRow) {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    brandColor: o.brand_color || '#3b5bdb',
    logoUrl: o.logo_url,
    cancelCutoffHours: o.cancel_cutoff_hours ?? 0,
    emailFrom: o.email_from,
    replyTo: o.reply_to,
    active: o.active !== 0,
  }
}

export function seedIfEmpty() {
  const count = (db.prepare('SELECT COUNT(*) AS c FROM organizations').get() as { c: number }).c
  if (count > 0) return
  const allowSeed =
    process.env.SEED_DEMO === '1' ||
    process.env.SEED_DEMO === 'true' ||
    process.env.AUTH_DISABLED === 'true' ||
    process.env.AUTH_DISABLED === '1' ||
    process.env.NODE_ENV !== 'production'
  if (!allowSeed) {
    console.warn('Kanta tyhjä — aseta SEED_DEMO=true ensimmäisellä käynnistyksellä')
    return
  }

  const now = new Date().toISOString()
  const org1 = crypto.randomUUID()
  const org2 = crypto.randomUUID()

  const insOrg = db.prepare(
    `INSERT INTO organizations (id, slug, name, brand_color, cancel_cutoff_hours, active, created_at)
     VALUES (?, ?, ?, ?, 0, 1, ?)`,
  )
  insOrg.run(org1, 'trainwithmarjo', 'TrainWithMarjo', '#3b5bdb', now)
  insOrg.run(org2, 'studio-flow', 'Studio Flow', '#0f766e', now)

  const insUser = db.prepare(
    `INSERT INTO users (uid, email, name, phone, role, org_id, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
  )
  insUser.run('owner-trainwithmarjo', 'marjo@trainwithmarjo.local', 'Marjo Hirvensalo', '0400000001', 'owner', org1, now)
  insUser.run('owner-studio-flow', 'coach@studioflow.local', 'Studio Flow Owner', '0400000002', 'owner', org2, now)
  insUser.run('superadmin', 'admin@vuoro.local', 'Vuoro Admin', null, 'superadmin', null, now)

  const monday = nextWeekday(1)
  const seriesId = crypto.randomUUID()
  const insSess = db.prepare(
    `INSERT INTO sessions (id, org_id, series_id, title, description, starts_at, ends_at, capacity,
      instructor_name, location_name, location_url, price, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (let w = 0; w < 4; w++) {
    for (const dow of [1, 3]) {
      const day = new Date(monday)
      day.setDate(monday.getDate() + w * 7 + (dow - 1))
      day.setHours(9, 0, 0, 0)
      const end = new Date(day)
      end.setMinutes(end.getMinutes() + 60)
      insSess.run(
        crypto.randomUUID(),
        org1,
        seriesId,
        'Aamujooga',
        'Rauhallinen aamuharjoitus kaikille tasoille.',
        day.toISOString(),
        end.toISOString(),
        12,
        'Marjo Hirvensalo',
        'Sali A',
        null,
        '15 €',
        'owner-trainwithmarjo',
        now,
      )
    }
  }
  console.log('Seedattu demo-yritykset: trainwithmarjo, studio-flow')
}

function nextWeekday(isoDow: number) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const js = isoDow === 7 ? 0 : isoDow
  const diff = (js - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}

export { db }
