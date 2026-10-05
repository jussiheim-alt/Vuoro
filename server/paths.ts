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

/** Writable data directory. Falls back to ./data if DATA_DIR (e.g. /var/data) is not mounted. */
export const dataDir = canUseDir(preferred)
  ? preferred
  : (() => {
      console.warn(
        `[vuoro] DATA_DIR=${preferred} ei ole kirjoitettavissa — käytetään ${fallback}. ` +
          'Lisää Renderissä Disk mount pathilla /var/data, jotta data säilyy redeployjen yli.',
      )
      fs.mkdirSync(fallback, { recursive: true })
      return fallback
    })()

export function ensureDataDir() {
  fs.mkdirSync(dataDir, { recursive: true })
}
