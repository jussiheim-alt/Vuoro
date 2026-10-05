import type { Request, Response, NextFunction } from 'express'
import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { db, type UserRow } from './db.ts'

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'vuoro-dev-secret-change-me-in-production',
)
const COOKIE = 'vuoro_session'

export type AuthedRequest = Request & { user?: UserRow }

async function signToken(user: UserRow) {
  return new SignJWT({ sub: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('180d')
    .sign(secret)
}

export async function readUserFromRequest(req: Request): Promise<UserRow | null> {
  const token = req.cookies?.[COOKIE] || bearer(req)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secret)
    const id = String(payload.sub || '')
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(id) as
      | UserRow
      | undefined
    return user || null
  } catch {
    return null
  }
}

function bearer(req: Request) {
  const h = req.header('authorization') || ''
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const user = await readUserFromRequest(req)
  if (!user) {
    res.status(401).json({ error: 'Kirjautuminen vaaditaan' })
    return
  }
  req.user = user
  next()
}

export async function loginHandler(req: Request, res: Response) {
  const username = String(req.body?.username || '').trim()
  const password = String(req.body?.password || '')
  const remember = req.body?.remember !== false
  if (!username || !password) {
    res.status(400).json({ error: 'Anna tunnus ja salasana' })
    return
  }
  const user = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1')
    .get(username) as UserRow | undefined
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Väärä tunnus tai salasana' })
    return
  }
  const token = await signToken(user)
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: remember ? 180 * 24 * 3600 * 1000 : 12 * 3600 * 1000,
  })
  res.json({
    user: { id: user.id, username: user.username, name: user.name, role: user.role },
  })
}

export function logoutHandler(_req: Request, res: Response) {
  res.clearCookie(COOKIE)
  res.status(204).end()
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Vain ylläpitäjä' })
    return
  }
  next()
}
