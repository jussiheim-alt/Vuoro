import type { Request, Response, NextFunction } from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { db, type UserRow } from './db.ts'

const projectId = process.env.FIREBASE_PROJECT_ID || 'vuoro-app'
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

export type AuthContext = {
  uid: string
  email?: string
  user: UserRow | null
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

function authDisabled() {
  return process.env.AUTH_DISABLED === 'true' || process.env.AUTH_DISABLED === '1'
}

async function verifyFirebase(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  })
  return {
    uid: String(payload.sub),
    email: typeof payload.email === 'string' ? payload.email : undefined,
  }
}

export async function resolveAuth(req: Request): Promise<AuthContext | null> {
  const devId = req.header('x-dev-user-id')?.trim()
  if (devId && authDisabled()) {
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(devId) as UserRow | undefined
    return { uid: devId, email: user?.email, user: user ?? null }
  }

  const hdr = req.header('authorization') || ''
  const m = hdr.match(/^Bearer\s+(.+)$/i)
  if (!m) return null
  try {
    const verified = await verifyFirebase(m[1])
    const user = db.prepare('SELECT * FROM users WHERE uid = ?').get(verified.uid) as UserRow | undefined
    return { uid: verified.uid, email: verified.email || user?.email, user: user ?? null }
  } catch {
    return null
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = (await resolveAuth(req)) || undefined
  next()
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = await resolveAuth(req)
  if (!auth) {
    res.status(401).json({ error: 'Kirjautuminen vaaditaan' })
    return
  }
  req.auth = auth
  next()
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.user || !req.auth.user.active) {
    res.status(401).json({ error: 'Käyttäjäprofiilia ei löydy — rekisteröidy' })
    return
  }
  next()
}

export function requireRoles(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.auth?.user?.role
    if (!role || !roles.includes(role)) {
      res.status(403).json({ error: 'Ei oikeuksia' })
      return
    }
    next()
  }
}

export function isCoachRole(role?: string | null) {
  return role === 'coach' || role === 'owner'
}
