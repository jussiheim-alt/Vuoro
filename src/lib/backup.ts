import type { AppData, Lecture, RolePerson, Speaker, Theme } from '../types'
import {
  clearPdfArchives,
  getPdfArchive,
  listPdfArchives,
  savePdfArchive,
  type PdfArchiveMeta,
} from './pdfArchive'
import { applyRetiredOutlineFlags, isRetiredOutline } from './retiredOutlines'
import {
  defaultSettings,
  emptyData,
  repairMessageTemplate,
} from './storage'

export const BACKUP_FORMAT = 'vuoro-backup' as const
export const BACKUP_VERSION = 1 as const

export type VuoroBackupPdf = PdfArchiveMeta & {
  mimeType: string
  blobBase64: string
}

export type VuoroBackup = {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: string
  data: AppData
  pdfArchives?: VuoroBackupPdf[]
}

function normalizeTheme(raw: Partial<Theme> & { name: string }): Theme {
  return applyRetiredOutlineFlags({
    id: raw.id ?? crypto.randomUUID(),
    number: raw.number ?? '',
    name: raw.name,
    notes: raw.notes ?? '',
    disabled: Boolean(raw.disabled),
    lastUsedAt: raw.lastUsedAt ?? null,
  })
}

function normalizeSpeaker(raw: Partial<Speaker> & { name: string }): Speaker {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name,
    phone: raw.phone ?? '',
    congregation: raw.congregation ?? '',
    outlines: Array.isArray(raw.outlines)
      ? raw.outlines.map(String).filter((o) => !isRetiredOutline(o))
      : [],
    notes: raw.notes ?? '',
    localOnly: Boolean(raw.localOnly),
    assistant: Boolean(raw.assistant),
    lastUsedAt: raw.lastUsedAt ?? null,
    snoozeUntil:
      typeof raw.snoozeUntil === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw.snoozeUntil)
        ? raw.snoozeUntil
        : null,
    unavailable: Boolean(raw.unavailable),
    unavailableReason:
      typeof raw.unavailableReason === 'string' ? raw.unavailableReason : '',
    onRoster: raw.onRoster !== false,
  }
}

function normalizeRolePerson(
  raw: Partial<RolePerson> & { name: string },
): RolePerson {
  return {
    id: raw.id ?? crypto.randomUUID(),
    name: raw.name,
    phone: raw.phone ?? '',
    notes: raw.notes ?? '',
    lastUsedAt: raw.lastUsedAt ?? null,
    alsoReads: raw.alsoReads !== false,
  }
}

function normalizeLecture(raw: Partial<Lecture> & { id: string }): Lecture {
  const notes = raw.notes ?? ''
  let eventKind = raw.eventKind
  if (
    eventKind !== 'talk' &&
    eventKind !== 'circuit_convention' &&
    eventKind !== 'regional_convention' &&
    eventKind !== 'circuit_week' &&
    eventKind !== 'memorial'
  ) {
    eventKind = /kierrosviikko/i.test(notes)
      ? 'circuit_week'
      : /muistojuhla/i.test(notes)
        ? 'memorial'
        : /aluekonventti/i.test(notes)
          ? 'regional_convention'
          : /kierroskonventti/i.test(notes)
            ? 'circuit_convention'
            : 'talk'
  }
  return {
    id: raw.id,
    date: raw.date ?? '',
    themeId: raw.themeId ?? '',
    speakerId: raw.speakerId ?? '',
    chairpersonId: raw.chairpersonId ?? null,
    readerId: raw.readerId ?? null,
    status: (raw.status as Lecture['status']) ?? 'planned',
    createdAt: raw.createdAt ?? new Date().toISOString(),
    notes,
    eventKind,
    customTitle: typeof raw.customTitle === 'string' ? raw.customTitle : '',
  }
}

export function normalizeAppData(raw: Partial<AppData> | null | undefined): AppData {
  if (!raw) return emptyData()
  const settings = { ...defaultSettings(), ...raw.settings }
  settings.messageTemplate = repairMessageTemplate(settings.messageTemplate)
  return {
    themes: (raw.themes ?? []).map((t) => normalizeTheme(t)),
    speakers: (raw.speakers ?? []).map((s) => normalizeSpeaker(s)),
    chairpersons: (raw.chairpersons ?? []).map((p) => normalizeRolePerson(p)),
    readers: (raw.readers ?? []).map((p) => normalizeRolePerson(p)),
    lectures: (raw.lectures ?? []).map((l) =>
      normalizeLecture(l as Lecture),
    ),
    settings,
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType || 'application/pdf' })
}

export async function buildBackup(
  data: AppData,
  options: { includePdfs?: boolean } = {},
): Promise<VuoroBackup> {
  const backup: VuoroBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: normalizeAppData(data),
  }

  if (options.includePdfs) {
    const metas = await listPdfArchives()
    const pdfArchives: VuoroBackupPdf[] = []
    for (const meta of metas) {
      const full = await getPdfArchive(meta.id)
      if (!full) continue
      pdfArchives.push({
        ...meta,
        mimeType: full.blob.type || 'application/pdf',
        blobBase64: await blobToBase64(full.blob),
      })
    }
    backup.pdfArchives = pdfArchives
  }

  return backup
}

export function downloadBackup(backup: VuoroBackup): void {
  const stamp = backup.exportedAt.slice(0, 10)
  const blob = new Blob([JSON.stringify(backup)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vuoro-varmuuskopio_${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
}

export function parseBackupJson(text: string): VuoroBackup {
  const parsed = JSON.parse(text) as Partial<VuoroBackup> & {
    data?: Partial<AppData>
  }
  if (parsed.format !== BACKUP_FORMAT) {
    throw new Error('Tiedosto ei ole Vuoro-varmuuskopio')
  }
  if (!parsed.data || typeof parsed.data !== 'object') {
    throw new Error('Varmuuskopiosta puuttuu data')
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: parsed.exportedAt ?? new Date().toISOString(),
    data: normalizeAppData(parsed.data),
    pdfArchives: Array.isArray(parsed.pdfArchives)
      ? parsed.pdfArchives
      : undefined,
  }
}

export async function applyBackup(backup: VuoroBackup): Promise<AppData> {
  const data = normalizeAppData(backup.data)
  if (backup.pdfArchives?.length) {
    await clearPdfArchives()
    for (const pdf of backup.pdfArchives) {
      await savePdfArchive({
        id: pdf.id,
        createdAt: pdf.createdAt,
        kind: pdf.kind,
        filename: pdf.filename,
        fromDate: pdf.fromDate,
        toDate: pdf.toDate,
        entryCount: pdf.entryCount,
        blob: base64ToBlob(pdf.blobBase64, pdf.mimeType),
      })
    }
  }
  return data
}
