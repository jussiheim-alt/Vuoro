import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * Filesystem blob/key-value store (Render disk or local data/runtime).
 */

export function createStore(rootDir) {
  const blobsDir = path.join(rootDir, 'blobs')
  fs.mkdirSync(blobsDir, { recursive: true })

  function safeKey(key) {
    if (!key || typeof key !== 'string') throw new Error('bad-key')
    if (key.length > 200 || key.includes('..') || key.includes('/') || key.includes('\\')) {
      throw new Error('bad-key')
    }
    return key
  }

  function fileFor(key) {
    return path.join(blobsDir, encodeURIComponent(safeKey(key)) + '.json')
  }

  return {
    async get(key) {
      const file = fileFor(key)
      try {
        return fs.readFileSync(file, 'utf8')
      } catch {
        return null
      }
    },
    async set(key, value) {
      const file = fileFor(key)
      fs.writeFileSync(file, value, 'utf8')
    },
    async delete(key) {
      const file = fileFor(key)
      try {
        fs.unlinkSync(file)
      } catch {
        /* ignore */
      }
    },
    newId() {
      return randomUUID()
    },
  }
}
