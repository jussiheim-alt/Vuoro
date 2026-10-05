import { getStore, type Store } from '@netlify/blobs'
import type { Handler, HandlerEvent } from '@netlify/functions'
import { randomUUID } from 'node:crypto'

const STORE_NAME = 'vuoro-sync'

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
      'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body: JSON.stringify(body),
  }
}

function text(status: number, body: string, contentType = 'application/json') {
  return {
    statusCode: status,
    headers: {
      'Content-Type': `${contentType}; charset=utf-8`,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
    body,
  }
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

  const pathParam = event.queryStringParameters?.path ?? ''
  const pathParts = pathParam.split('/').filter(Boolean)
  const roomId =
    event.queryStringParameters?.room || pathParts[0] || undefined
  const key =
    event.queryStringParameters?.key || pathParts[1] || undefined

  if (event.httpMethod === 'POST' && !roomId) {
    const id = randomUUID()
    await store.set(`room:${id}:created`, new Date().toISOString())
    return json(200, { id })
  }

  if (!roomId || !/^[0-9a-f-]{36}$/i.test(roomId)) {
    return json(400, { ok: false, reason: 'bad-room' })
  }

  if (!key || !/^[a-z0-9_-]{1,64}$/i.test(key)) {
    return json(400, { ok: false, reason: 'bad-key' })
  }

  const blobKey = `room:${roomId}:${key}`

  if (event.httpMethod === 'GET') {
    const value = await store.get(blobKey)
    if (value == null) return json(404, { ok: false, reason: 'missing' })
    return text(200, value, 'application/json')
  }

  if (event.httpMethod === 'PUT') {
    const body = event.body ?? ''
    if (!body || body.length > 2_500_000) {
      return json(413, { ok: false, reason: 'too-large' })
    }
    await store.set(blobKey, body)
    return json(200, { ok: true })
  }

  if (event.httpMethod === 'DELETE') {
    await store.delete(blobKey)
    return json(200, { ok: true })
  }

  return json(405, { ok: false, reason: 'method' })
}
