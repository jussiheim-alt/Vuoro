import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin, PreviewServer, ViteDevServer } from 'vite'

const ROOT = path.resolve(import.meta.dirname, '..')
const BACKUP_DIR = path.join(ROOT, 'data', 'cloud-backups')
const LATEST_PATH = path.join(BACKUP_DIR, 'latest.json')
const META_PATH = path.join(BACKUP_DIR, 'latest.meta.json')

type BackupMeta = {
  exportedAt: string
  themes: number
  speakers: number
  lectures: number
  chairpersons: number
  readers: number
  bytes: number
}

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(text)
}

function buildMeta(raw: string, exportedAt: string): BackupMeta {
  let themes = 0
  let speakers = 0
  let lectures = 0
  let chairpersons = 0
  let readers = 0
  try {
    const parsed = JSON.parse(raw) as {
      data?: {
        themes?: unknown[]
        speakers?: unknown[]
        lectures?: unknown[]
        chairpersons?: unknown[]
        readers?: unknown[]
      }
    }
    themes = parsed.data?.themes?.length ?? 0
    speakers = parsed.data?.speakers?.length ?? 0
    lectures = parsed.data?.lectures?.length ?? 0
    chairpersons = parsed.data?.chairpersons?.length ?? 0
    readers = parsed.data?.readers?.length ?? 0
  } catch {
    /* ignore parse for meta counts */
  }
  return {
    exportedAt,
    themes,
    speakers,
    lectures,
    chairpersons,
    readers,
    bytes: Buffer.byteLength(raw, 'utf8'),
  }
}

function attachCloudBackupApi(middlewares: Connect.Server) {
  middlewares.use(async (req, res, next) => {
    const url = req.url?.split('?')[0] ?? ''
    if (!url.startsWith('/api/cloud-backup')) return next()

    try {
      if (url === '/api/cloud-backup/meta' && req.method === 'GET') {
        if (!fs.existsSync(META_PATH) && !fs.existsSync(LATEST_PATH)) {
          sendJson(res, 404, { ok: false, reason: 'missing' })
          return
        }
        if (fs.existsSync(META_PATH)) {
          const meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')) as BackupMeta
          sendJson(res, 200, { ok: true, ...meta })
          return
        }
        const raw = fs.readFileSync(LATEST_PATH, 'utf8')
        const parsed = JSON.parse(raw) as { exportedAt?: string }
        const meta = buildMeta(raw, parsed.exportedAt ?? new Date().toISOString())
        sendJson(res, 200, { ok: true, ...meta })
        return
      }

      if (url === '/api/cloud-backup' && req.method === 'GET') {
        if (!fs.existsSync(LATEST_PATH)) {
          sendJson(res, 404, { ok: false, reason: 'missing' })
          return
        }
        const raw = fs.readFileSync(LATEST_PATH, 'utf8')
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(raw)
        return
      }

      if (url === '/api/cloud-backup' && (req.method === 'PUT' || req.method === 'POST')) {
        const raw = await readBody(req)
        if (!raw || raw.length < 2) {
          sendJson(res, 400, { ok: false, reason: 'empty' })
          return
        }
        if (raw.length > 25_000_000) {
          sendJson(res, 413, { ok: false, reason: 'too-large' })
          return
        }
        let parsed: { format?: string; exportedAt?: string; data?: unknown }
        try {
          parsed = JSON.parse(raw) as typeof parsed
        } catch {
          sendJson(res, 400, { ok: false, reason: 'invalid-json' })
          return
        }
        if (parsed.format !== 'vuoro-backup' || !parsed.data) {
          sendJson(res, 400, { ok: false, reason: 'not-vuoro-backup' })
          return
        }
        ensureDir()
        const stamp = (parsed.exportedAt ?? new Date().toISOString()).replace(
          /[:.]/g,
          '-',
        )
        const archivePath = path.join(BACKUP_DIR, `vuoro-${stamp}.json`)
        fs.writeFileSync(LATEST_PATH, raw, 'utf8')
        fs.writeFileSync(archivePath, raw, 'utf8')
        const meta = buildMeta(
          raw,
          parsed.exportedAt ?? new Date().toISOString(),
        )
        fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2), 'utf8')
        // Keep only the newest few archives (+ latest)
        const archives = fs
          .readdirSync(BACKUP_DIR)
          .filter((f) => f.startsWith('vuoro-') && f.endsWith('.json'))
          .sort()
          .reverse()
        for (const old of archives.slice(8)) {
          fs.unlinkSync(path.join(BACKUP_DIR, old))
        }
        sendJson(res, 200, { ok: true, ...meta })
        return
      }

      if (url === '/api/cloud-backup' && req.method === 'DELETE') {
        ensureDir()
        for (const name of fs.readdirSync(BACKUP_DIR)) {
          fs.unlinkSync(path.join(BACKUP_DIR, name))
        }
        sendJson(res, 200, { ok: true })
        return
      }

      sendJson(res, 405, { ok: false, reason: 'method' })
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        reason: err instanceof Error ? err.message : 'error',
      })
    }
  })
}

function attach(server: ViteDevServer | PreviewServer) {
  attachCloudBackupApi(server.middlewares)
}

/** Persist Vuoro backups on the Vite host so tunnel URL changes don't wipe data. */
export function cloudBackupPlugin(): Plugin {
  return {
    name: 'vuoro-cloud-backup',
    configureServer(server) {
      attach(server)
    },
    configurePreviewServer(server) {
      attach(server)
    },
  }
}
