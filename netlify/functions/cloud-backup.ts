import { getStore, type Store } from '@netlify/blobs'
import type { Handler, HandlerEvent } from '@netlify/functions'

const STORE_NAME = 'vuoro-sync'
const BACKUP_KEY = 'site:latest:backup'
const META_KEY = 'site:latest:meta'

function syncStore(): Store {
  try {
    return getStore(STORE_NAME)
  } catch {
    const siteID = process.env.SITE_ID || process.env.NETLIFY_SITE_ID
    const token =
      process.env.NETLIFY_BLOBS_TOKEN ||
      process.env.NETLIFY_API_TOKEN ||
      process.env.NETLIFY_AUTH_TOKEN
    if (!siteID || !token) throw new Error('Blobs not configured')
    return getStore({ name: STORE_NAME, siteID, token })
  }
}

function json(status: number, body: unknown) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  }
}

function text(status: number, body: string) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  }
}

function isMetaRequest(event: HandlerEvent): boolean {
  if (event.queryStringParameters?.meta === '1') return true
  return (event.path || '').endsWith('/meta')
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod === 'OPTIONS') {
    return text(204, '')
  }

  let store: Store
  try {
    store = syncStore()
  } catch (err) {
    return json(500, {
      ok: false,
      reason: err instanceof Error ? err.message : 'blobs',
    })
  }

  const metaOnly = isMetaRequest(event)

  if (event.httpMethod === 'GET') {
    if (metaOnly) {
      const raw = await store.get(META_KEY)
      if (raw == null) return json(404, { ok: false, reason: 'missing' })
      return text(200, raw)
    }
    const raw = await store.get(BACKUP_KEY)
    if (raw == null) return json(404, { ok: false, reason: 'missing' })
    return text(200, raw)
  }

  if (event.httpMethod === 'PUT') {
    const body = event.body ?? ''
    if (!body || body.length > 2_500_000) {
      return json(413, { ok: false, reason: 'too-large' })
    }
    let parsed: {
      format?: string
      exportedAt?: string
      data?: {
        themes?: unknown[]
        speakers?: unknown[]
        lectures?: unknown[]
        chairpersons?: unknown[]
        readers?: unknown[]
      }
    }
    try {
      parsed = JSON.parse(body) as typeof parsed
    } catch {
      return json(400, { ok: false, reason: 'invalid-json' })
    }
    if (parsed.format !== 'vuoro-backup' || !parsed.data) {
      return json(400, { ok: false, reason: 'not-vuoro-backup' })
    }
    const meta = {
      ok: true,
      exportedAt: parsed.exportedAt ?? new Date().toISOString(),
      themes: parsed.data.themes?.length ?? 0,
      speakers: parsed.data.speakers?.length ?? 0,
      lectures: parsed.data.lectures?.length ?? 0,
      chairpersons: parsed.data.chairpersons?.length ?? 0,
      readers: parsed.data.readers?.length ?? 0,
      bytes: Buffer.byteLength(body, 'utf8'),
    }
    await store.set(BACKUP_KEY, body)
    await store.set(META_KEY, JSON.stringify(meta))
    return json(200, meta)
  }

  if (event.httpMethod === 'DELETE') {
    await store.delete(BACKUP_KEY)
    await store.delete(META_KEY)
    return json(200, { ok: true })
  }

  return json(405, { ok: false, reason: 'method' })
}
