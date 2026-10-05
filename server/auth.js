import { createHmac, timingSafeEqual } from 'node:crypto'
import { loginPageHtml } from './loginPage.js'

const COOKIE_SESSION = 'vuoro_session'
const COOKIE_USER = 'vuoro_user'
const DAY = 24 * 60 * 60
export const REMEMBER_MAX_AGE = 180 * DAY
export const DEFAULT_MAX_AGE = 14 * DAY

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function b64urlEncodeStr(s) {
  return b64url(Buffer.from(s, 'utf8'))
}

function b64urlDecodeStr(s) {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
}

export function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.VUORO_SITE_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    ''
  )
}

export function makeSessionToken(user, role, maxAgeSec, secret) {
  const exp = String(Math.floor(Date.now() / 1000) + maxAgeSec)
  const payload = `${b64urlEncodeStr(user)}.${b64urlEncodeStr(role)}.${b64urlEncodeStr(exp)}`
  const sig = b64url(
    createHmac('sha256', `${secret}|vuoro-gate-v2`).update(payload).digest(),
  )
  return `${payload}.${sig}`
}

export function verifySessionToken(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 4) return null
  const [uEnc, roleEnc, expEnc, sig] = parts
  const user = b64urlDecodeStr(uEnc)
  const role = b64urlDecodeStr(roleEnc)
  const expStr = b64urlDecodeStr(expEnc)
  if (!user || !role || !expStr) return null
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null
  const payload = `${uEnc}.${roleEnc}.${expEnc}`
  const expected = b64url(
    createHmac('sha256', `${secret}|vuoro-gate-v2`).update(payload).digest(),
  )
  try {
    const a = Buffer.from(sig)
    const b = Buffer.from(expected)
    if (a.length !== b.length) return null
    if (!timingSafeEqual(a, b)) return null
  } catch {
    return null
  }
  return { username: user, role }
}

export function parseCookies(header) {
  const out = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (!k) continue
    try {
      out[k] = decodeURIComponent(v)
    } catch {
      out[k] = v
    }
  }
  return out
}

export function cookieHeader(name, value, maxAge, httpOnly) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
  ]
  if (process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1') {
    parts.push('Secure')
  }
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

export function clearCookie(name, httpOnly) {
  const parts = [`${name}=`, 'Path=/', 'Max-Age=0', 'SameSite=Lax']
  if (process.env.NODE_ENV === 'production' || process.env.FORCE_SECURE_COOKIES === '1') {
    parts.push('Secure')
  }
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

export function safeNextPath(raw, origin) {
  if (!raw) return '/'
  try {
    if (raw.startsWith('/') && !raw.startsWith('//')) return raw
    const u = new URL(raw, origin)
    if (u.origin === origin) return u.pathname + u.search + u.hash
  } catch {
    /* ignore */
  }
  return '/'
}

export function createAuth({ users }) {
  const secret = () => getSessionSecret()

  function authEnabled() {
    return users.hasUsers() && !!secret()
  }

  function readSession(req) {
    if (!authEnabled()) return null
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[COOKIE_SESSION]
    if (!token) return null
    const session = verifySessionToken(token, secret())
    if (!session) return null
    const live = users.findByUsername(session.username)
    if (!live) return null
    return { username: live.username, role: live.role, id: live.id }
  }

  function requireAuth(req, res, next) {
    if (!authEnabled()) return next()
    const session = readSession(req)
    if (session) {
      req.vuoroUser = session
      return next()
    }
    const accept = req.headers.accept || ''
    if (accept.includes('application/json') || req.path.startsWith('/api/')) {
      return res.status(401).json({ ok: false, reason: 'auth' })
    }
    const nextPath = safeNextPath(req.originalUrl || '/', `${req.protocol}://${req.get('host')}`)
    const cookies = parseCookies(req.headers.cookie)
    res
      .status(401)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        loginPageHtml({
          userPrefill: cookies[COOKIE_USER] || '',
          nextPath,
          remember: true,
        }),
      )
  }

  function requireAdmin(req, res, next) {
    if (!authEnabled()) return next()
    if (!req.vuoroUser || req.vuoroUser.role !== 'admin') {
      return res.status(403).json({ ok: false, reason: 'admin' })
    }
    next()
  }

  async function handleLoginPost(req, res) {
    const origin = `${req.protocol}://${req.get('host')}`
    const body = req.body || {}
    const user = String(body.username || '').trim()
    const pass = String(body.password || '')
    const remember =
      body.remember === '1' || body.remember === 'on' || body.remember === true
    const nextPath = safeNextPath(String(body.next || '/'), origin)

    const authed = users.authenticate(user, pass)
    if (!authed) {
      return res
        .status(401)
        .set('Cache-Control', 'no-store')
        .type('html')
        .send(
          loginPageHtml({
            error: 'Väärä tunnus tai salasana.',
            userPrefill: user,
            nextPath,
            remember,
          }),
        )
    }

    const maxAge = remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE
    const token = makeSessionToken(authed.username, authed.role, maxAge, secret())
    res.setHeader('Set-Cookie', [
      cookieHeader(COOKIE_SESSION, token, maxAge, true),
      cookieHeader(COOKIE_USER, authed.username, maxAge, false),
    ])
    res.redirect(303, nextPath)
  }

  function handleLogout(req, res) {
    const cookies = parseCookies(req.headers.cookie)
    res.setHeader('Set-Cookie', [
      clearCookie(COOKIE_SESSION, true),
      clearCookie(COOKIE_USER, false),
    ])
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        loginPageHtml({
          userPrefill: cookies[COOKIE_USER] || '',
          nextPath: '/',
        }),
      )
  }

  function showLogin(req, res) {
    const origin = `${req.protocol}://${req.get('host')}`
    const cookies = parseCookies(req.headers.cookie)
    const nextPath = safeNextPath(req.query.next || '/', origin)
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(
        loginPageHtml({
          userPrefill: cookies[COOKIE_USER] || '',
          nextPath,
          remember: true,
        }),
      )
  }

  return {
    authEnabled,
    readSession,
    requireAuth,
    requireAdmin,
    handleLoginPost,
    handleLogout,
    showLogin,
    COOKIE_SESSION,
    COOKIE_USER,
  }
}
