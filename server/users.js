import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

function hashPassword(password, salt) {
  const s = salt || randomBytes(16).toString('hex')
  const hash = scryptSync(password, s, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  }).toString('hex')
  return { salt: s, passwordHash: hash }
}

function verifyPassword(password, salt, passwordHash) {
  try {
    const { passwordHash: next } = hashPassword(password, salt)
    const a = Buffer.from(passwordHash, 'hex')
    const b = Buffer.from(next, 'hex')
    if (a.length !== b.length) return false
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    createdAt: u.createdAt,
  }
}

export function createUserStore(dataDir) {
  const file = path.join(dataDir, 'users.json')
  fs.mkdirSync(dataDir, { recursive: true })

  function read() {
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed.users)) return { users: [] }
      return parsed
    } catch {
      return { users: [] }
    }
  }

  function write(state) {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  }

  function ensureBootstrapAdmin() {
    const state = read()
    if (state.users.length > 0) return state

    const username = (process.env.ADMIN_USERNAME || process.env.VUORO_BASIC_USER || 'vuoro').trim()
    const password =
      process.env.ADMIN_PASSWORD ||
      process.env.VUORO_SITE_PASSWORD ||
      ''

    if (!password) {
      console.warn(
        '[vuoro] No users yet and ADMIN_PASSWORD / VUORO_SITE_PASSWORD is unset — auth disabled until configured.',
      )
      return state
    }

    const { salt, passwordHash } = hashPassword(password)
    const admin = {
      id: randomUUID(),
      username,
      salt,
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
    }
    state.users.push(admin)
    write(state)
    console.log(`[vuoro] Bootstrap admin user created: ${username}`)
    return state
  }

  ensureBootstrapAdmin()

  return {
    list() {
      return read().users.map(publicUser)
    },
    findByUsername(username) {
      const u = username.trim().toLowerCase()
      return read().users.find((x) => x.username.toLowerCase() === u) || null
    },
    findById(id) {
      return read().users.find((x) => x.id === id) || null
    },
    authenticate(username, password) {
      const user = this.findByUsername(username)
      if (!user) return null
      if (!verifyPassword(password, user.salt, user.passwordHash)) return null
      return publicUser(user)
    },
    create({ username, password, role = 'user' }) {
      const name = String(username || '').trim()
      if (!name || name.length < 2 || name.length > 64) {
        throw new Error('bad-username')
      }
      if (!/^[a-zA-Z0-9._@+-]+$/.test(name)) {
        throw new Error('bad-username')
      }
      if (!password || String(password).length < 6) {
        throw new Error('bad-password')
      }
      const r = role === 'admin' ? 'admin' : 'user'
      const state = read()
      if (state.users.some((x) => x.username.toLowerCase() === name.toLowerCase())) {
        throw new Error('exists')
      }
      const { salt, passwordHash } = hashPassword(String(password))
      const user = {
        id: randomUUID(),
        username: name,
        salt,
        passwordHash,
        role: r,
        createdAt: new Date().toISOString(),
      }
      state.users.push(user)
      write(state)
      return publicUser(user)
    },
    updatePassword(id, password) {
      if (!password || String(password).length < 6) throw new Error('bad-password')
      const state = read()
      const idx = state.users.findIndex((x) => x.id === id)
      if (idx < 0) throw new Error('missing')
      const { salt, passwordHash } = hashPassword(String(password))
      state.users[idx] = { ...state.users[idx], salt, passwordHash }
      write(state)
      return publicUser(state.users[idx])
    },
    remove(id) {
      const state = read()
      const target = state.users.find((x) => x.id === id)
      if (!target) throw new Error('missing')
      const admins = state.users.filter((x) => x.role === 'admin')
      if (target.role === 'admin' && admins.length <= 1) {
        throw new Error('last-admin')
      }
      state.users = state.users.filter((x) => x.id !== id)
      write(state)
      return true
    },
    hasUsers() {
      return read().users.length > 0
    },
    publicUser,
  }
}
