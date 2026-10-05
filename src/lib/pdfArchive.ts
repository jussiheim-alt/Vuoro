import type { SchedulePdfKind } from './pdfExport'
import { uid } from './storage'

const DB_NAME = 'vuoro-pdf-archive'
const DB_VERSION = 1
const STORE = 'pdfs'

export type PdfArchiveEntry = {
  id: string
  kind: SchedulePdfKind
  filename: string
  fromDate: string
  toDate: string
  createdAt: string
  entryCount: number
  blob: Blob
}

export type PdfArchiveMeta = Omit<PdfArchiveEntry, 'blob'>

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('kind', 'kind', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB tx failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB tx aborted'))
  })
}

export async function savePdfArchive(
  entry: Omit<PdfArchiveEntry, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  },
): Promise<PdfArchiveMeta> {
  const full: PdfArchiveEntry = {
    id: entry.id ?? uid(),
    createdAt: entry.createdAt ?? new Date().toISOString(),
    kind: entry.kind,
    filename: entry.filename,
    fromDate: entry.fromDate,
    toDate: entry.toDate,
    entryCount: entry.entryCount,
    blob: entry.blob,
  }
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(full)
    await txDone(tx)
  } finally {
    db.close()
  }
  const { blob: _blob, ...meta } = full
  return meta
}

export async function listPdfArchives(
  kind?: SchedulePdfKind | 'all',
): Promise<PdfArchiveMeta[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    const rows = await new Promise<PdfArchiveEntry[]>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as PdfArchiveEntry[]) ?? [])
      req.onerror = () => reject(req.error)
    })
    await txDone(tx)
    return rows
      .filter((r) => (kind && kind !== 'all' ? r.kind === kind : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ blob: _b, ...meta }) => meta)
  } finally {
    db.close()
  }
}

export async function getPdfArchive(
  id: string,
): Promise<PdfArchiveEntry | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    const row = await new Promise<PdfArchiveEntry | undefined>(
      (resolve, reject) => {
        req.onsuccess = () => resolve(req.result as PdfArchiveEntry | undefined)
        req.onerror = () => reject(req.error)
      },
    )
    await txDone(tx)
    return row ?? null
  } finally {
    db.close()
  }
}

export async function deletePdfArchive(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}

export async function clearPdfArchives(): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await txDone(tx)
  } finally {
    db.close()
  }
}

export function kindLabel(kind: SchedulePdfKind): string {
  return kind === 'PJ' ? 'PJ-lista' : 'Ilmoitustaulu'
}
