import path from 'node:path'
import fs from 'node:fs'

const preferred = process.env.DATA_DIR || path.join(process.cwd(), 'data')
const fallback = path.join(process.cwd(), 'data')

function canUseDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export const dataDir = canUseDir(preferred)
  ? preferred
  : (() => {
      console.warn(`[vuoro] DATA_DIR=${preferred} ei kirjoitettavissa — käytetään ${fallback}`)
      fs.mkdirSync(fallback, { recursive: true })
      return fallback
    })()

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true })
}
