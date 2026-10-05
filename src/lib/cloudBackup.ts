import {
  BACKUP_FORMAT,
  type VuoroBackup,
  buildBackup,
  parseBackupJson,
} from './backup'
import type { AppData } from '../types'

export type CloudBackupMeta = {
  ok: true
  themes: number
  speakers: number
  lectures: number
  chairpersons: number
  readers: number
  bytes: number
  exportedAt: string
  /** Present when sync uses a hostthis room id. */
  roomId?: string
}

const SYNC_FLAG = 'vuoro-cloud-sync-v1'
const ROOM_KEY = 'vuoro-sync-room-v1'

/** Permanent public site. Prefer current origin when already hosted. */
export const PERMANENT_APP_URL =
  typeof window !== 'undefined' &&
  window.location?.origin &&
  !/localhost|127\.0\.0\.1/.test(window.location.hostname)
    ? window.location.origin
    : 'https://vuoro-vaaksy.netlify.app'

export function isCloudSyncEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SYNC_FLAG)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

export function setCloudSyncEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(SYNC_FLAG, enabled ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export function getSyncRoomId(): string | null {
  try {
    return localStorage.getItem(ROOM_KEY)
  } catch {
    return null
  }
}

export function setSyncRoomId(roomId: string | null): void {
  try {
    if (!roomId) localStorage.removeItem(ROOM_KEY)
    else localStorage.setItem(ROOM_KEY, roomId.trim())
  } catch {
    /* ignore */
  }
}

function metaFromBackup(backup: VuoroBackup, bytes: number): CloudBackupMeta {
  return {
    ok: true,
    exportedAt: backup.exportedAt,
    themes: backup.data.themes.length,
    speakers: backup.data.speakers.length,
    lectures: backup.data.lectures.length,
    chairpersons: backup.data.chairpersons.length,
    readers: backup.data.readers.length,
    bytes,
    roomId: getSyncRoomId() ?? undefined,
  }
}

async function tryViteMeta(): Promise<CloudBackupMeta | null> {
  try {
    const res = await fetch(`/api/cloud-backup/meta?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = (await res.json()) as CloudBackupMeta & { ok?: boolean }
    if (!json?.ok || !json.exportedAt) return null
    return json
  } catch {
    return null
  }
}

async function ensureRoomId(): Promise<string | null> {
  const existing = getSyncRoomId()
  if (existing) return existing
  try {
    const res = await fetch('/api/rooms', { method: 'POST' })
    if (!res.ok) return null
    const json = (await res.json()) as { id?: string }
    if (!json.id) return null
    setSyncRoomId(json.id)
    return json.id
  } catch {
    return null
  }
}

function roomUrl(roomId: string, key: string): string {
  // Query form works on both Netlify redirects and the Render Express server.
  const q = new URLSearchParams({ room: roomId, key })
  return `/api/rooms?${q.toString()}`
}

async function roomGet(roomId: string, key: string): Promise<Response | null> {
  try {
    const res = await fetch(`${roomUrl(roomId, key)}&t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (res.status === 404) return null
    if (!res.ok) return null
    return res
  } catch {
    return null
  }
}

async function roomPut(
  roomId: string,
  key: string,
  body: string,
): Promise<boolean> {
  try {
    const res = await fetch(roomUrl(roomId, key), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    return res.ok
  } catch {
    return false
  }
}

async function tryRoomMeta(): Promise<CloudBackupMeta | null> {
  const roomId = getSyncRoomId()
  if (!roomId) return null
  const res = await roomGet(roomId, 'meta')
  if (!res) return null
  try {
    const json = (await res.json()) as CloudBackupMeta
    if (!json?.exportedAt) return null
    return { ...json, ok: true, roomId }
  } catch {
    return null
  }
}

export async function fetchCloudBackupMeta(): Promise<CloudBackupMeta | null> {
  return (await tryViteMeta()) ?? (await tryRoomMeta())
}

export async function fetchCloudBackup(): Promise<VuoroBackup | null> {
  try {
    const vite = await fetch(`/api/cloud-backup?t=${Date.now()}`, {
      cache: 'no-store',
    })
    if (vite.ok) {
      return parseBackupJson(await vite.text())
    }
  } catch {
    /* fall through to room */
  }

  const roomId = getSyncRoomId()
  if (!roomId) return null
  const res = await roomGet(roomId, 'backup')
  if (!res) return null
  try {
    return parseBackupJson(await res.text())
  } catch {
    return null
  }
}

export async function pushCloudBackup(data: AppData): Promise<boolean> {
  if (!isCloudSyncEnabled()) return false
  if (data.themes.length === 0 && data.speakers.length === 0) return false
  try {
    const backup = await buildBackup(data, { includePdfs: false })
    const body = JSON.stringify(backup)
    const meta = metaFromBackup(backup, body.length)

    // Prefer Vite middleware when available (dev / tunnel).
    try {
      const vite = await fetch('/api/cloud-backup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (vite.ok) return true
    } catch {
      /* use room */
    }

    const roomId = await ensureRoomId()
    if (!roomId) return false
    const okBackup = await roomPut(roomId, 'backup', body)
    const okMeta = await roomPut(roomId, 'meta', JSON.stringify(meta))
    return okBackup && okMeta
  } catch {
    return false
  }
}

export async function clearCloudBackup(): Promise<boolean> {
  let ok = false
  try {
    const res = await fetch('/api/cloud-backup', { method: 'DELETE' })
    ok = res.ok
  } catch {
    /* ignore */
  }
  const roomId = getSyncRoomId()
  if (roomId) {
    try {
      await fetch(roomUrl(roomId, 'backup'), { method: 'DELETE' })
      await fetch(roomUrl(roomId, 'meta'), { method: 'DELETE' })
      ok = true
    } catch {
      /* ignore */
    }
  }
  return ok
}

export function formatCloudBackupWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fi-FI', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function isVuoroBackupPayload(raw: unknown): raw is VuoroBackup {
  return (
    !!raw &&
    typeof raw === 'object' &&
    (raw as VuoroBackup).format === BACKUP_FORMAT &&
    typeof (raw as VuoroBackup).data === 'object'
  )
}
