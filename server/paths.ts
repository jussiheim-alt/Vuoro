import path from 'node:path'
import fs from 'node:fs'

export const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data')

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true })
}
