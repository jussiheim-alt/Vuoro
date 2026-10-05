/**
 * Branded login gate for Vuoro (Netlify Edge).
 * Env: VUORO_SITE_PASSWORD (required), VUORO_BASIC_USER (default "vuoro").
 *
 * - Shows a modern login page (no browser Basic Auth dialog)
 * - Sets a signed HttpOnly cookie so the device stays signed in
 * - "Muista minut" → 180 days; otherwise 14 days
 */

const COOKIE_SESSION = 'vuoro_session'
const COOKIE_USER = 'vuoro_user'
const LOGIN_PATH = '/__vuoro_login'
const LOGOUT_PATH = '/__vuoro_logout'

const DAY = 24 * 60 * 60
const REMEMBER_MAX_AGE = 180 * DAY
const DEFAULT_MAX_AGE = 14 * DAY

function envPassword(): string | null {
  return Netlify.env.get('VUORO_SITE_PASSWORD') || null
}

function envUser(): string {
  return Netlify.env.get('VUORO_BASIC_USER') || 'vuoro'
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlEncodeStr(s: string): string {
  return b64url(new TextEncoder().encode(s))
}

function b64urlDecodeStr(s: string): string | null {
  try {
    const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

async function signPayload(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payload),
  )
  return b64url(sig)
}

async function makeSessionToken(
  user: string,
  password: string,
  maxAgeSec: number,
): Promise<string> {
  const exp = String(Math.floor(Date.now() / 1000) + maxAgeSec)
  const payload = `${b64urlEncodeStr(user)}.${b64urlEncodeStr(exp)}`
  const sig = await signPayload(`${password}|vuoro-gate-v1`, payload)
  return `${payload}.${sig}`
}

async function verifySessionToken(
  token: string,
  expectedUser: string,
  password: string,
): Promise<boolean> {
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [uEnc, expEnc, sig] = parts
  const user = b64urlDecodeStr(uEnc)
  const expStr = b64urlDecodeStr(expEnc)
  if (!user || !expStr) return false
  if (user !== expectedUser) return false
  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false
  const payload = `${uEnc}.${expEnc}`
  const expected = await signPayload(`${password}|vuoro-gate-v1`, payload)
  if (sig.length !== expected.length) return false
  let ok = 0
  for (let i = 0; i < sig.length; i++) ok |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  return ok === 0
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
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

function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'SameSite=Lax',
    'Secure',
  ]
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

function clearCookie(name: string, httpOnly: boolean): string {
  const parts = [
    `${name}=`,
    'Path=/',
    'Max-Age=0',
    'SameSite=Lax',
    'Secure',
  ]
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

async function credentialsOk(
  user: string,
  pass: string,
  expectedUser: string,
  password: string,
): Promise<boolean> {
  return user === expectedUser && pass === password
}

async function hasValidBasic(
  request: Request,
  expectedUser: string,
  password: string,
): Promise<boolean> {
  const header = request.headers.get('authorization') || ''
  if (!header.startsWith('Basic ')) return false
  try {
    const decoded = atob(header.slice(6))
    const colon = decoded.indexOf(':')
    const user = colon >= 0 ? decoded.slice(0, colon) : ''
    const pass = colon >= 0 ? decoded.slice(colon + 1) : ''
    return credentialsOk(user, pass, expectedUser, password)
  } catch {
    return false
  }
}

async function hasValidSession(
  request: Request,
  expectedUser: string,
  password: string,
): Promise<boolean> {
  const cookies = parseCookies(request.headers.get('cookie'))
  const token = cookies[COOKIE_SESSION]
  if (!token) return false
  return verifySessionToken(token, expectedUser, password)
}

function safeNextPath(raw: string | null, origin: string): string {
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

function loginPageHtml(opts: {
  error?: string
  userPrefill?: string
  nextPath?: string
  remember?: boolean
}): string {
  const error = opts.error
    ? `<p class="err" role="alert">${escapeHtml(opts.error)}</p>`
    : ''
  const user = escapeHtml(opts.userPrefill || '')
  const next = escapeHtml(opts.nextPath || '/')
  const rememberChecked = opts.remember === false ? '' : ' checked'

  return `<!doctype html>
<html lang="fi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#1B3D36" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <title>Vuoro — kirjaudu</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,500;9..144,700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --pine: #1b3d36;
      --pine-mid: #2a5c50;
      --accent: #c45c26;
      --ink: #14241f;
      --ink-soft: #3d534b;
      --muted: #6a7f76;
      --line: rgba(20, 36, 31, 0.14);
      --surface: rgba(247, 251, 247, 0.92);
      --font-display: "Fraunces", Georgia, serif;
      --font-body: "Figtree", system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    html, body { min-height: 100%; margin: 0; }
    body {
      font-family: var(--font-body);
      color: #e8f0e9;
      background:
        radial-gradient(120% 80% at 8% 0%, #2a5a4c 0%, transparent 55%),
        radial-gradient(90% 60% at 100% 10%, rgba(196, 92, 38, 0.28) 0%, transparent 50%),
        linear-gradient(165deg, #1b3d36 0%, #0f241f 55%, #1a322c 100%);
      display: grid;
      place-items: center;
      padding: max(1.25rem, env(safe-area-inset-top)) 1.25rem max(1.25rem, env(safe-area-inset-bottom));
    }
    .card {
      width: min(100%, 26rem);
      background: var(--surface);
      color: var(--ink);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 1.6rem 1.35rem 1.5rem;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
      animation: rise 0.45s ease both;
    }
    @keyframes rise {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .brand {
      font-family: var(--font-display);
      font-size: clamp(2.4rem, 8vw, 3rem);
      font-weight: 700;
      letter-spacing: -0.03em;
      color: var(--pine);
      line-height: 0.95;
      margin: 0 0 0.35rem;
    }
    h1 {
      font-family: var(--font-display);
      font-size: 1.45rem;
      margin: 0 0 0.35rem;
      color: var(--pine);
    }
    .lede {
      margin: 0 0 1.25rem;
      color: var(--ink-soft);
      line-height: 1.45;
      font-size: 0.98rem;
    }
    form { display: grid; gap: 0.85rem; }
    label {
      display: grid;
      gap: 0.35rem;
      font-size: 0.85rem;
      font-weight: 650;
      color: var(--ink-soft);
    }
    input[type="text"],
    input[type="password"] {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 0.8rem 0.9rem;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }
    input:focus {
      outline: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);
      outline-offset: 1px;
      border-color: var(--accent);
    }
    .remember {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      color: var(--ink-soft);
      font-weight: 600;
      font-size: 0.95rem;
      user-select: none;
    }
    .remember input { width: 1.1rem; height: 1.1rem; accent-color: var(--pine); }
    .err {
      margin: 0;
      color: #9b2f2f;
      background: #f3dede;
      border-radius: 10px;
      padding: 0.65rem 0.8rem;
      font-size: 0.92rem;
      font-weight: 600;
    }
    button[type="submit"] {
      appearance: none;
      border: none;
      border-radius: 12px;
      background: var(--accent);
      color: #fff8f3;
      font: inherit;
      font-weight: 700;
      padding: 0.9rem 1.1rem;
      cursor: pointer;
      transition: filter 0.15s ease, transform 0.15s ease;
    }
    button[type="submit"]:hover { filter: brightness(1.05); }
    button[type="submit"]:active { transform: translateY(1px); }
    .hint {
      margin: 0.15rem 0 0;
      color: var(--muted);
      font-size: 0.82rem;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <main class="card">
    <p class="brand">Vuoro</p>
    <h1>Kirjaudu sisään</h1>
    <p class="lede">Sunnuntaiesitelmien suunnittelu — tunnukset muistetaan tällä laitteella.</p>
    ${error}
    <form method="post" action="${LOGIN_PATH}" autocomplete="on">
      <input type="hidden" name="next" value="${next}" />
      <label>
        Käyttäjätunnus
        <input
          name="username"
          type="text"
          inputmode="text"
          autocomplete="username"
          autocapitalize="none"
          spellcheck="false"
          required
          value="${user}"
        />
      </label>
      <label>
        Salasana
        <input
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <label class="remember">
        <input type="checkbox" name="remember" value="1"${rememberChecked} />
        Muista minut tällä laitteella
      </label>
      <button type="submit">Kirjaudu</button>
      <p class="hint">Valinta pitää sinut kirjautuneena noin puoli vuotta. Voit kirjautua ulos asetuksista myöhemmin tarvittaessa.</p>
    </form>
  </main>
  <script>
    // Prefill username from localStorage if cookie was cleared but device remembers it.
    try {
      var saved = localStorage.getItem('vuoro-login-user');
      var input = document.querySelector('input[name="username"]');
      if (saved && input && !input.value) input.value = saved;
      document.querySelector('form').addEventListener('submit', function () {
        var u = document.querySelector('input[name="username"]').value.trim();
        var remember = document.querySelector('input[name="remember"]').checked;
        if (remember && u) localStorage.setItem('vuoro-login-user', u);
      });
    } catch (e) {}
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function htmlResponse(html: string, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

export default async function gate(request: Request, context: { next: () => Promise<Response> }) {
  const password = envPassword()
  if (!password) {
    return context.next()
  }

  const expectedUser = envUser()
  const url = new URL(request.url)
  const cookies = parseCookies(request.headers.get('cookie'))

  // Logout clears session and shows login
  if (url.pathname === LOGOUT_PATH) {
    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    headers.append('Set-Cookie', clearCookie(COOKIE_SESSION, true))
    headers.append('Set-Cookie', clearCookie(COOKIE_USER, false))
    return new Response(
      loginPageHtml({
        userPrefill: cookies[COOKIE_USER] || '',
        nextPath: '/',
      }),
      { status: 200, headers },
    )
  }

  // Already authenticated → continue (also allow silent Basic for scripts)
  if (
    (await hasValidSession(request, expectedUser, password)) ||
    (await hasValidBasic(request, expectedUser, password))
  ) {
    if (url.pathname === LOGIN_PATH) {
      return Response.redirect(new URL('/', url.origin), 303)
    }
    return context.next()
  }

  // Login form submit
  if (url.pathname === LOGIN_PATH && request.method === 'POST') {
    let user = ''
    let pass = ''
    let remember = true
    let nextPath = '/'
    try {
      const form = await request.formData()
      user = String(form.get('username') ?? '').trim()
      pass = String(form.get('password') ?? '')
      remember = form.get('remember') === '1' || form.get('remember') === 'on'
      nextPath = safeNextPath(String(form.get('next') ?? '/'), url.origin)
    } catch {
      return htmlResponse(
        loginPageHtml({
          error: 'Lomakkeen luku epäonnistui. Kokeile uudelleen.',
          nextPath: '/',
        }),
        400,
      )
    }

    if (!(await credentialsOk(user, pass, expectedUser, password))) {
      return htmlResponse(
        loginPageHtml({
          error: 'Väärä tunnus tai salasana.',
          userPrefill: user,
          nextPath,
          remember,
        }),
        401,
      )
    }

    const maxAge = remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE
    const token = await makeSessionToken(user, password, maxAge)
    const headers = new Headers({
      Location: nextPath,
      'Cache-Control': 'no-store',
    })
    // Multiple Set-Cookie: append separately
    headers.append(
      'Set-Cookie',
      cookieHeader(COOKIE_SESSION, token, maxAge, true),
    )
    headers.append(
      'Set-Cookie',
      cookieHeader(COOKIE_USER, user, maxAge, false),
    )
    return new Response(null, { status: 303, headers })
  }

  // GET login page or any protected path → branded login (never WWW-Authenticate)
  const nextPath =
    url.pathname === LOGIN_PATH
      ? safeNextPath(url.searchParams.get('next'), url.origin)
      : safeNextPath(url.pathname + url.search, url.origin)

  return htmlResponse(
    loginPageHtml({
      userPrefill: cookies[COOKIE_USER] || '',
      nextPath,
      remember: true,
    }),
  )
}

export const config = { path: '/*' }
