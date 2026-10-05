const LOCK_KEY = 'vuoro-app-lock-v1'
const UNLOCKED_KEY = 'vuoro-unlocked-v1'
const HIDDEN_AT_KEY = 'vuoro-lock-hidden-at'

/** Re-lock after this many ms in background (1 min). */
export const RELOCK_AFTER_MS = 60_000

export type AppLockConfig = {
  enabled: boolean
  saltB64: string
  hashB64: string
  iterations: number
  /** Base64url credential id for platform authenticator (Face ID / Touch ID). */
  webauthnCredentialId?: string | null
}

const ITERATIONS = 120_000

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function toBase64Url(buf: ArrayBuffer): string {
  return bufToB64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): ArrayBuffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad
  return b64ToBuf(b64)
}

async function derivePinHash(
  pin: string,
  salt: ArrayBuffer,
  iterations: number,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256,
  )
}

function timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  const aa = new Uint8Array(a)
  const bb = new Uint8Array(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
  return diff === 0
}

export function loadLockConfig(): AppLockConfig | null {
  try {
    const raw = localStorage.getItem(LOCK_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppLockConfig>
    if (
      !parsed.enabled ||
      typeof parsed.saltB64 !== 'string' ||
      typeof parsed.hashB64 !== 'string' ||
      typeof parsed.iterations !== 'number'
    ) {
      return null
    }
    return {
      enabled: true,
      saltB64: parsed.saltB64,
      hashB64: parsed.hashB64,
      iterations: parsed.iterations,
      webauthnCredentialId:
        typeof parsed.webauthnCredentialId === 'string'
          ? parsed.webauthnCredentialId
          : null,
    }
  } catch {
    return null
  }
}

function saveLockConfig(cfg: AppLockConfig | null): void {
  try {
    if (!cfg) localStorage.removeItem(LOCK_KEY)
    else localStorage.setItem(LOCK_KEY, JSON.stringify(cfg))
  } catch {
    /* ignore */
  }
}

export function isLockEnabled(): boolean {
  return loadLockConfig()?.enabled === true
}

export function isSessionUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCKED_KEY) === '1'
  } catch {
    return false
  }
}

export function markSessionUnlocked(): void {
  try {
    sessionStorage.setItem(UNLOCKED_KEY, '1')
    sessionStorage.removeItem(HIDDEN_AT_KEY)
  } catch {
    /* ignore */
  }
}

export function markSessionLocked(): void {
  try {
    sessionStorage.removeItem(UNLOCKED_KEY)
  } catch {
    /* ignore */
  }
}

export function noteAppHidden(): void {
  try {
    sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()))
  } catch {
    /* ignore */
  }
}

/** Returns true if the session should re-lock after returning from background. */
export function shouldRelockAfterBackground(): boolean {
  if (!isLockEnabled()) return false
  try {
    const raw = sessionStorage.getItem(HIDDEN_AT_KEY)
    if (!raw) return false
    const hiddenAt = Number(raw)
    if (!Number.isFinite(hiddenAt)) return false
    return Date.now() - hiddenAt >= RELOCK_AFTER_MS
  } catch {
    return false
  }
}

export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin)
}

export async function enableLockWithPin(pin: string): Promise<AppLockConfig> {
  if (!isValidPin(pin)) throw new Error('PIN:n on oltava 4–8 numeroa')
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer
  const hash = await derivePinHash(pin, salt, ITERATIONS)
  const cfg: AppLockConfig = {
    enabled: true,
    saltB64: bufToB64(salt),
    hashB64: bufToB64(hash),
    iterations: ITERATIONS,
    webauthnCredentialId: null,
  }
  saveLockConfig(cfg)
  markSessionUnlocked()
  return cfg
}

export async function verifyPin(pin: string): Promise<boolean> {
  const cfg = loadLockConfig()
  if (!cfg) return false
  const hash = await derivePinHash(pin, b64ToBuf(cfg.saltB64), cfg.iterations)
  return timingSafeEqual(hash, b64ToBuf(cfg.hashB64))
}

export async function changePin(
  currentPin: string,
  nextPin: string,
): Promise<void> {
  if (!(await verifyPin(currentPin))) throw new Error('Nykyinen PIN on väärä')
  const prev = loadLockConfig()
  const next = await enableLockWithPin(nextPin)
  if (prev?.webauthnCredentialId) {
    next.webauthnCredentialId = prev.webauthnCredentialId
    saveLockConfig(next)
  }
}

export async function disableLock(currentPin: string): Promise<void> {
  if (!(await verifyPin(currentPin))) throw new Error('PIN on väärä')
  saveLockConfig(null)
  markSessionUnlocked()
}

export function biometricsSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator.credentials?.create === 'function'
  )
}

export async function platformAuthenticatorAvailable(): Promise<boolean> {
  if (!biometricsSupported()) return false
  try {
    if (
      typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable ===
      'function'
    ) {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
    }
  } catch {
    /* ignore */
  }
  return false
}

export async function registerBiometricUnlock(): Promise<boolean> {
  const cfg = loadLockConfig()
  if (!cfg) throw new Error('Aseta ensin PIN')
  if (!biometricsSupported()) throw new Error('Biometria ei ole tuettu')

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const userId = crypto.getRandomValues(new Uint8Array(16))
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Vuoro', id: window.location.hostname },
      user: {
        id: userId,
        name: 'vuoro-local',
        displayName: 'Vuoro',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      attestation: 'none',
    },
  })) as PublicKeyCredential | null

  if (!cred) return false
  const next = {
    ...cfg,
    webauthnCredentialId: toBase64Url(cred.rawId),
  }
  saveLockConfig(next)
  return true
}

export async function unlockWithBiometric(): Promise<boolean> {
  const cfg = loadLockConfig()
  if (!cfg?.webauthnCredentialId) return false
  if (!biometricsSupported()) return false

  const challenge = crypto.getRandomValues(new Uint8Array(32))
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      allowCredentials: [
        {
          type: 'public-key',
          id: fromBase64Url(cfg.webauthnCredentialId),
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60_000,
    },
  })
  if (!assertion) return false
  markSessionUnlocked()
  return true
}

export function hasBiometricUnlock(): boolean {
  return Boolean(loadLockConfig()?.webauthnCredentialId)
}

export async function clearBiometricUnlock(currentPin: string): Promise<void> {
  if (!(await verifyPin(currentPin))) throw new Error('PIN on väärä')
  const cfg = loadLockConfig()
  if (!cfg) return
  saveLockConfig({ ...cfg, webauthnCredentialId: null })
}
