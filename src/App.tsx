import { useDeferredValue, useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from 'react'
import type {
  AppData,
  LectureStatus,
  Speaker,
  Theme,
} from './types'
import { CalendarView } from './components/CalendarView'
import { ImportAndFilters } from './components/ImportAndFilters'
import { InstallPrompt } from './components/InstallPrompt'
import { AppLockGate } from './components/AppLockGate'
import { LockSettings } from './components/LockSettings'
import { UserAdminPanel } from './components/UserAdminPanel'
import { PdfListsView } from './components/PdfListsView'
import { RolePeopleView } from './components/RolePeopleView'
import {
  downloadText,
  parseSpeakersCsv,
  parseThemesCsv,
  speakersToCsv,
  themesToCsv,
} from './lib/csv'
import {
  historyToLectures,
  parseExcelWorkbook,
} from './lib/excelImport'
import { exportSchedulePdf } from './lib/pdfExport'
import { buildBackup, downloadBackup, parseBackupJson, applyBackup } from './lib/backup'
import {
  clearCloudBackup,
  fetchCloudBackup,
  fetchCloudBackupMeta,
  formatCloudBackupWhen,
  getSyncRoomId,
  isCloudSyncEnabled,
  PERMANENT_APP_URL,
  pushCloudBackup,
  setCloudSyncEnabled,
  setSyncRoomId,
  type CloudBackupMeta,
} from './lib/cloudBackup'
import { clearPdfArchives } from './lib/pdfArchive'
import {
  applyLectureToLists,
  createLecture,
  deferLectureAsk,
  ensureAlsoReadsOnReadersList,
  isDateBooked,
  nextFreeSundayISO,
  pushSpeakerSkipCooldown,
  pushThemeSkipCooldown,
  rankSpeakers,
  rankThemes,
  recommend,
  recommendChairAndReader,
  recomputeLastUsed,
  uniqueCongregations,
  type RecommendMode,
} from './lib/recommend'
import {
  THEME_CATEGORIES,
  categoryCounts,
  type ThemeCategoryId,
} from './lib/themeCategories'
import { isRetiredOutline } from './lib/retiredOutlines'
import { applySeedToData, fetchKierrosSeed } from './lib/seed'
import { filterSpeakersByQuery } from './lib/speakerSearch'
import {
  applySyksy2026Roles,
  syksy2026RoleSummary,
} from './lib/seedRolesFromSchedule'
import {
  formatDateFi,
  formatDaysSince,
  loadData,
  repairMessageTemplate,
  saveData,
  themeLabel,
  todayISO,
  uid,
} from './lib/storage'
import {
  buildMessage,
  formatLectureDateFi,
  whatsappUrl,
} from './lib/whatsapp'
import { loadUiState, saveUiState, type Tab } from './lib/uiState'

function mergeByName<T extends { name: string; id: string }>(
  existing: T[],
  incoming: T[],
  merge: (oldItem: T, neu: T) => T,
): T[] {
  const map = new Map(existing.map((e) => [e.name.toLowerCase(), e]))
  for (const item of incoming) {
    const key = item.name.toLowerCase()
    const prev = map.get(key)
    map.set(key, prev ? merge(prev, item) : item)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'fi'))
}

export default function App() {
  const initialUi = loadUiState()
  const initialData = loadData()
  const [data, setData] = useState<AppData>(() => initialData)
  const [tab, setTab] = useState<Tab>(() => initialUi.tab)
  const [toast, setToast] = useState<string | null>(null)
  const [lectureDate, setLectureDate] = useState(
    () => initialUi.lectureDate ?? nextFreeSundayISO(initialData),
  )
  const [skipSpeakers, setSkipSpeakers] = useState<string[]>(
    () => initialUi.skipSpeakers,
  )
  const [skipThemes, setSkipThemes] = useState<string[]>(
    () => initialUi.skipThemes,
  )
  const [skipChairs, setSkipChairs] = useState<string[]>(
    () => initialUi.skipChairs,
  )
  const [skipReaders, setSkipReaders] = useState<string[]>(
    () => initialUi.skipReaders,
  )
  const [messageDraft, setMessageDraft] = useState(
    () => initialUi.messageDraft,
  )
  const [editingTheme, setEditingTheme] = useState<Theme | null>(() => {
    if (!initialUi.editingThemeId) return null
    return initialData.themes.find((t) => t.id === initialUi.editingThemeId) ?? null
  })
  const [editingSpeaker, setEditingSpeaker] = useState<Speaker | null>(() => {
    if (!initialUi.editingSpeakerId) return null
    return (
      initialData.speakers.find((s) => s.id === initialUi.editingSpeakerId) ??
      null
    )
  })
  const [cloudMeta, setCloudMeta] = useState<CloudBackupMeta | null>(null)
  const [cloudSyncOn, setCloudSyncOn] = useState(() => isCloudSyncEnabled())
  const [cloudBusy, setCloudBusy] = useState(false)
  const [speakerQuery, setSpeakerQuery] = useState(
    () => initialUi.speakerQuery,
  )
  const deferredSpeakerQuery = useDeferredValue(speakerQuery)
  const [lockNonce, setLockNonce] = useState(0)
  const [syncRoomInput, setSyncRoomInput] = useState(() => getSyncRoomId() ?? '')
  const [recMode, setRecMode] = useState<RecommendMode>(
    () => initialUi.recMode,
  )
  const [recTopicCategory, setRecTopicCategory] =
    useState<ThemeCategoryId | null>(() => initialUi.recTopicCategory)
  const [recCongregation, setRecCongregation] = useState<string | null>(
    () => initialUi.recCongregation,
  )

  // Persist navigation + in-progress UI so reloads don't dump you on Suositus.
  useEffect(() => {
    saveUiState({
      tab,
      lectureDate,
      skipSpeakers,
      skipThemes,
      skipChairs,
      skipReaders,
      messageDraft,
      speakerQuery,
      editingSpeakerId: editingSpeaker?.id ?? null,
      editingThemeId: editingTheme?.id ?? null,
      recMode,
      recTopicCategory,
      recCongregation,
    })
  }, [
    tab,
    lectureDate,
    skipSpeakers,
    skipThemes,
    skipChairs,
    skipReaders,
    messageDraft,
    speakerQuery,
    editingSpeaker,
    editingTheme,
    recMode,
    recTopicCategory,
    recCongregation,
  ])

  useEffect(() => {
    saveData(data)
  }, [data])

  // Keep a copy on the Vite host so a new trycloudflare URL still has recovery.
  useEffect(() => {
    if (!cloudSyncOn) return
    if (data.themes.length === 0 && data.speakers.length === 0) return
    const timer = window.setTimeout(() => {
      void pushCloudBackup(data).then((ok) => {
        if (!ok) return
        void fetchCloudBackupMeta().then((meta) => {
          if (meta) setCloudMeta(meta)
        })
      })
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [data, cloudSyncOn])

  useEffect(() => {
    void fetchCloudBackupMeta().then((meta) => {
      if (meta) setCloudMeta(meta)
    })
  }, [])

  // First visit on a new device: auto-restore server backup when local lists are empty.
  useEffect(() => {
    if (data.themes.length > 0 || data.speakers.length > 0 || data.lectures.length > 0) {
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const backup = await fetchCloudBackup()
        if (!backup || cancelled) return
        const next = await applyBackup(backup)
        if (cancelled) return
        setData(next)
        const meta = await fetchCloudBackupMeta()
        if (meta) setCloudMeta(meta)
        showToast(
          `Palvelimen data ladattu (${backup.data.lectures.length} esitelmää)`,
        )
      } catch {
        /* empty state still offers manual restore */
      }
    })()
    return () => {
      cancelled = true
    }
    // Intentionally once on mount for empty local data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // After WhatsApp: restore booking if iOS suspended the PWA before React flushed.
  // Only runs when we explicitly left for WhatsApp — not on every tab focus.
  useEffect(() => {
    function syncFromStorage() {
      if (document.visibilityState === 'hidden') return
      try {
        if (sessionStorage.getItem('vuoro-wa-return') !== '1') return
        sessionStorage.removeItem('vuoro-wa-return')
      } catch {
        return
      }
      const fresh = loadData()
      setData((prev) => {
        if (fresh.lectures.length === prev.lectures.length) {
          const prevIds = new Set(prev.lectures.map((l) => l.id))
          if (fresh.lectures.every((l) => prevIds.has(l.id))) return prev
        }
        return fresh
      })
    }
    document.addEventListener('visibilitychange', syncFromStorage)
    window.addEventListener('pageshow', syncFromStorage)
    return () => {
      document.removeEventListener('visibilitychange', syncFromStorage)
      window.removeEventListener('pageshow', syncFromStorage)
    }
  }, [])

  // One-shot repair of stale WhatsApp templates from localStorage
  useEffect(() => {
    setData((prev) => {
      const fixed = repairMessageTemplate(prev.settings.messageTemplate)
      let next = prev
      if (fixed !== prev.settings.messageTemplate) {
        next = {
          ...next,
          settings: { ...next.settings, messageTemplate: fixed },
        }
      }
      return ensureAlsoReadsOnReadersList(next)
    })
  }, [])

  // Apply autumn 2026 PJ/lukija sample once (or when lists were empty)
  useEffect(() => {
    const flag = 'vuoro-syksy2026-roles-v1'
    setData((prev) => {
      const already = localStorage.getItem(flag)
      if (already && prev.chairpersons.length > 0) return prev
      const next = applySyksy2026Roles(prev)
      localStorage.setItem(flag, '1')
      return next
    })
  }, [])

  // Keep recommendation date on the earliest free Sunday:
  // — after a WhatsApp ask books the current date → advance
  // — after a booking is removed and an earlier Sunday frees → move back
  useEffect(() => {
    const free = nextFreeSundayISO(data)
    if (free === lectureDate) return
    if (isDateBooked(data, lectureDate) || free < lectureDate) {
      setLectureDate(free)
    }
  }, [data, lectureDate])

  const dateBooked = isDateBooked(data, lectureDate)
  const bookingOnDate = data.lectures.find(
    (l) =>
      l.date === lectureDate &&
      l.status !== 'declined' &&
      l.status !== 'deferred',
  )

  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(t)
  }, [toast])

  const topicOptions = useMemo(
    () => categoryCounts(data.themes),
    [data.themes],
  )
  const congregationOptions = useMemo(
    () => uniqueCongregations(data.speakers),
    [data.speakers],
  )

  const rec = useMemo(() => {
    if (recMode === 'topic' && !recTopicCategory) return null
    if (recMode === 'congregation' && !recCongregation) return null
    return recommend(data, {
      skipSpeakerIds: skipSpeakers,
      skipThemeIds: skipThemes,
      lectureDate,
      mode: recMode,
      topicCategory: recTopicCategory,
      congregation: recCongregation,
    })
  }, [
    data,
    skipSpeakers,
    skipThemes,
    lectureDate,
    recMode,
    recTopicCategory,
    recCongregation,
  ])

  const hasLists = data.themes.length > 0 && data.speakers.length > 0

  function clearRecSkips() {
    setSkipThemes([])
    setSkipSpeakers([])
    setSkipChairs([])
    setSkipReaders([])
  }

  function changeRecMode(mode: RecommendMode) {
    if (mode === recMode) return
    setRecMode(mode)
    clearRecSkips()
    if (mode === 'topic' && !recTopicCategory && topicOptions[0]) {
      setRecTopicCategory(topicOptions[0].id)
    }
    if (mode === 'congregation' && !recCongregation && congregationOptions[0]) {
      setRecCongregation(congregationOptions[0])
    }
  }

  const recLede = (() => {
    if (recMode === 'topic') {
      const label =
        THEME_CATEGORIES.find((c) => c.id === recTopicCategory)?.label ??
        'valittua aihetta'
      return `Suositus rajataan aiheeseen ${label}. Jäsennyksistä valitaan pisimpään käyttämättä ollut, jolle löytyy sopiva puhuja (vähintään 10 kk edellisestä vuorosta).`
    }
    if (recMode === 'congregation') {
      const cong = recCongregation || 'valittua seurakuntaa'
      return `Suositus rajataan seurakuntaan ${cong}. Teema valitaan pisimpään käyttämättä olleista jäsennyksistä, joille löytyy puhuja kyseisestä seurakunnasta (vähintään 10 kk edellisestä vuorosta).`
    }
    return 'Valinta perustuu jäsennyksiin joita ei ole pidetty vähään aikaan, ja puhujiin jotka osaavat kyseisen jäsennyksen. Samaa puhujaa ei ehdoteta, jos edellisestä tai tulevasta vuorosta on alle 10 kk.'
  })()

  const { chair: recChair, reader: recReader } = useMemo(
    () =>
      recommendChairAndReader(data, {
        skipChairIds: skipChairs,
        skipReaderIds: skipReaders,
      }),
    [data, skipChairs, skipReaders],
  )

  useEffect(() => {
    setSkipChairs([])
    setSkipReaders([])
  }, [lectureDate])

  // Keep topic / congregation picks valid when lists reload.
  useEffect(() => {
    if (recMode !== 'topic') return
    if (
      recTopicCategory &&
      topicOptions.some((o) => o.id === recTopicCategory)
    ) {
      return
    }
    setRecTopicCategory(topicOptions[0]?.id ?? null)
  }, [recMode, recTopicCategory, topicOptions])

  useEffect(() => {
    if (recMode !== 'congregation') return
    if (
      recCongregation &&
      congregationOptions.some((c) => c === recCongregation)
    ) {
      return
    }
    setRecCongregation(congregationOptions[0] ?? null)
  }, [recMode, recCongregation, congregationOptions])

  useEffect(() => {
    if (!rec) {
      setMessageDraft('')
      return
    }
    setMessageDraft(
      buildMessage(data.settings.messageTemplate, {
        nimi: rec.speaker.name,
        teema: rec.theme.name,
        numero: rec.theme.number,
        päivä: formatLectureDateFi(lectureDate),
        tapahtuma: data.settings.eventName,
      }),
    )
  }, [rec, lectureDate, data.settings.messageTemplate, data.settings.eventName])

  const themeRank = useMemo(() => rankThemes(data.themes), [data.themes])
  const speakerRank = useMemo(() => rankSpeakers(data.speakers), [data.speakers])
  const filteredSpeakers = useMemo(
    () => filterSpeakersByQuery(speakerRank, deferredSpeakerQuery, data.themes),
    [speakerRank, deferredSpeakerQuery, data.themes],
  )

  function showToast(msg: string) {
    setToast(msg)
  }

  function importThemes(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseThemesCsv(text)
      if (!parsed.length) {
        showToast('Teemoja ei löytynyt tiedostosta')
        return
      }
      setData((prev) => ({
        ...prev,
        themes: mergeByName(prev.themes, parsed, (oldItem, neu) => ({
          ...oldItem,
          notes: neu.notes || oldItem.notes,
          lastUsedAt: neu.lastUsedAt || oldItem.lastUsedAt,
        })),
      }))
      showToast(`Ladattu ${parsed.length} teemaa`)
    }
    reader.readAsText(file)
  }

  function importSpeakers(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const parsed = parseSpeakersCsv(text)
      if (!parsed.length) {
        showToast('Puhujia ei löytynyt tiedostosta')
        return
      }
      setData((prev) => ({
        ...prev,
        speakers: mergeByName(prev.speakers, parsed, (oldItem, neu) => ({
          ...oldItem,
          phone: neu.phone || oldItem.phone,
          notes: neu.notes || oldItem.notes,
          lastUsedAt: neu.lastUsedAt || oldItem.lastUsedAt,
        })),
      }))
      showToast(`Ladattu ${parsed.length} puhujaa`)
    }
    reader.readAsText(file)
  }

  function importExcel(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      const buffer = reader.result
      if (!(buffer instanceof ArrayBuffer)) {
        showToast('Excelin luku epäonnistui')
        return
      }
      const parsed = parseExcelWorkbook(buffer)
      const lectures = historyToLectures(
        parsed.history,
        parsed.themes,
        parsed.speakers,
      )
      setData((prev) => {
        const themes = mergeByName(prev.themes, parsed.themes, (oldItem, neu) => ({
          ...oldItem,
          notes: neu.notes || oldItem.notes,
          lastUsedAt: neu.lastUsedAt || oldItem.lastUsedAt,
        }))
        const speakers = mergeByName(
          prev.speakers,
          parsed.speakers,
          (oldItem, neu) => ({
            ...oldItem,
            phone: neu.phone || oldItem.phone,
            notes: neu.notes || oldItem.notes,
            lastUsedAt: neu.lastUsedAt || oldItem.lastUsedAt,
          }),
        )
        const next = recomputeLastUsed({
          ...prev,
          themes,
          speakers,
          lectures: [...lectures, ...prev.lectures],
        })
        return next
      })
      showToast(
        `Excel: ${parsed.themes.length} teemaa, ${parsed.speakers.length} puhujaa, ${lectures.length} historiaa`,
      )
      setTab('historia')
    }
    reader.readAsArrayBuffer(file)
  }

  function onFile(
    e: ChangeEvent<HTMLInputElement>,
    handler: (file: File) => void,
  ) {
    const file = e.target.files?.[0]
    if (file) handler(file)
    e.target.value = ''
  }

  function saveAsPlanned() {
    if (!rec) return
    const lecture = createLecture(
      rec.theme.id,
      rec.speaker.id,
      lectureDate,
      'planned',
      {
        chairpersonId: recChair?.id ?? null,
        readerId: recReader?.id ?? null,
      },
    )
    setData((prev) => {
      const next = { ...prev, lectures: [lecture, ...prev.lectures] }
      // Persist immediately so a tab switch cannot lose the booking
      saveData(next)
      return next
    })
    setSkipThemes([])
    setSkipSpeakers([])
    setSkipChairs([])
    setSkipReaders([])
    showToast('Tallennettu historiaan (kysytty) — seuraava vapaa aika')
  }

  function markConfirmedAndOpenWhatsApp() {
    if (!rec) return
    const url = whatsappUrl(rec.speaker.phone, messageDraft)
    if (!url) {
      showToast('Lisää puhujalle puhelinnumero ensin')
      return
    }

    const lecture = createLecture(
      rec.theme.id,
      rec.speaker.id,
      lectureDate,
      'planned',
      {
        chairpersonId: recChair?.id ?? null,
        readerId: recReader?.id ?? null,
      },
    )
    // Save synchronously BEFORE opening WhatsApp — on iPhone the PWA may
    // suspend/unload immediately and skip the normal save effect.
    setData((prev) => {
      const next = { ...prev, lectures: [lecture, ...prev.lectures] }
      saveData(next)
      return next
    })
    setSkipThemes([])
    setSkipSpeakers([])
    setSkipChairs([])
    setSkipReaders([])

    showToast('WhatsApp avattu — varaus kalenterissa (kysytty)')
    try {
      sessionStorage.setItem('vuoro-wa-return', '1')
    } catch {
      /* ignore */
    }
    // Prefer same-tab navigation / anchor: window.open is unreliable in iOS PWA
    const a = document.createElement('a')
    a.href = url
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  function updateLectureStatus(id: string, status: LectureStatus) {
    setData((prev) => {
      const lectures = prev.lectures.map((l) =>
        l.id === id ? { ...l, status } : l,
      )
      let next: AppData = { ...prev, lectures }
      const lec = lectures.find((l) => l.id === id)
      if (lec && (status === 'confirmed' || status === 'done')) {
        next = applyLectureToLists(next, lec)
      }
      if (
        status === 'declined' ||
        status === 'deferred' ||
        status === 'planned'
      ) {
        next = recomputeLastUsed(next)
      }
      return next
    })
  }

  function markDeferred(lectureId: string, months: number) {
    setData((prev) => recomputeLastUsed(deferLectureAsk(prev, lectureId, months)))
    showToast(`Merkitty: palataan ~${months} kk kuluttua`)
  }

  function addTheme(theme: Omit<Theme, 'id'>) {
    setData((prev) => ({
      ...prev,
      themes: [...prev.themes, { ...theme, id: uid() }].sort((a, b) =>
        a.name.localeCompare(b.name, 'fi'),
      ),
    }))
  }

  function addSpeaker(speaker: Omit<Speaker, 'id'>) {
    setData((prev) => ({
      ...prev,
      speakers: [...prev.speakers, { ...speaker, id: uid() }].sort((a, b) =>
        a.name.localeCompare(b.name, 'fi'),
      ),
    }))
  }

  function saveThemeEdit(theme: Theme) {
    setData((prev) => ({
      ...prev,
      themes: prev.themes.map((t) => (t.id === theme.id ? theme : t)),
    }))
    setEditingTheme(null)
  }

  function saveSpeakerEdit(speaker: Speaker) {
    setData((prev) => ({
      ...prev,
      speakers: prev.speakers.map((s) => (s.id === speaker.id ? speaker : s)),
    }))
    setEditingSpeaker(null)
  }

  function deleteTheme(theme: Theme) {
    const label = themeLabel(theme)
    if (
      !window.confirm(
        `Poistetaanko teema “${label}”? Tätä ei voi perua.`,
      )
    ) {
      return
    }
    setData((prev) => ({
      ...prev,
      themes: prev.themes.filter((t) => t.id !== theme.id),
    }))
  }

  function deleteSpeaker(speaker: Speaker) {
    if (
      !window.confirm(
        `Poistetaanko puhuja “${speaker.name}”? Tätä ei voi perua.`,
      )
    ) {
      return
    }
    setData((prev) => ({
      ...prev,
      speakers: prev.speakers.filter((s) => s.id !== speaker.id),
    }))
  }

  function deleteLecture(lectureId: string, summary: string) {
    if (
      !window.confirm(
        `Poistetaanko esitelmä “${summary}”? Tätä ei voi perua.`,
      )
    ) {
      return
    }
    setData((prev) =>
      recomputeLastUsed({
        ...prev,
        lectures: prev.lectures.filter((l) => l.id !== lectureId),
      }),
    )
  }

  async function loadKierrosList() {
    try {
      const seed = await fetchKierrosSeed()
      setData((prev) => applySyksy2026Roles(applySeedToData(prev, seed)))
      setSkipSpeakers([])
      setSkipThemes([])
      showToast(
        `Kierros ${seed.kierros} + historia: ${seed.themes.length} teemaa, ${seed.speakers.length} puhujaa, ${seed.history?.length ?? 0} esitelmää`,
      )
      setTab('suositus')
    } catch {
      showToast('Kierroslistan lataus epäonnistui')
    }
  }

  async function restoreCloudBackup() {
    setCloudBusy(true)
    try {
      const backup = await fetchCloudBackup()
      if (!backup) {
        showToast('Palvelimella ei ole varmuuskopiota')
        return
      }
      const next = await applyBackup(backup)
      setData(next)
      setSkipSpeakers([])
      setSkipThemes([])
      setSkipChairs([])
      setSkipReaders([])
      const meta = await fetchCloudBackupMeta()
      if (meta) setCloudMeta(meta)
      showToast(
        `Palvelimen varmuuskopio palautettu (${backup.data.lectures.length} esitelmää, ${backup.data.speakers.length} puhujaa)`,
      )
      setTab('suositus')
    } catch {
      showToast('Palvelimen varmuuskopion palautus epäonnistui')
    } finally {
      setCloudBusy(false)
    }
  }

  function loadSyksyRoles() {
    setData((prev) => {
      const next = applySyksy2026Roles(prev)
      showToast(`PJ/lukijat päivitetty: ${syksy2026RoleSummary(next)}`)
      return next
    })
    localStorage.setItem('vuoro-syksy2026-roles-v1', '1')
  }

  const themeName = (id: string) => {
    const t = data.themes.find((x) => x.id === id)
    return t ? themeLabel(t) : '—'
  }
  const speakerName = (id: string) =>
    data.speakers.find((s) => s.id === id)?.name ?? '—'

  return (
    <AppLockGate lockNonce={lockNonce}>
    <div className="app-shell">
      <InstallPrompt />
      <header className="brand-bar">
        <div className="brand">
          <div className="brand-mark">Vuoro</div>
          <p className="brand-tag">
            Suosittelee seuraavan sunnuntaiesitelmän teeman ja puhujan — ja avaa
            valmiin WhatsApp-kutsun.
          </p>
        </div>
      </header>

      <nav className="nav-tabs" aria-label="Näkymät">
        {(
          [
            ['suositus', 'Suositus'],
            ['kalenteri', 'Kalenteri'],
            ['teemat', 'Teemat'],
            ['puhujat', 'Puhujat'],
            ['puheenjohtajat', 'Puheenjohtajat'],
            ['lukijat', 'Lukijat'],
            ['historia', 'Historia'],
            ['pdf-listat', 'PDF-listat'],
            ['tuonti', 'Tuonti'],
            ['asetukset', 'Asetukset'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'suositus' && (
        <section className="panel hero-rec">
          <div className="rec-main">
            <h2>Seuraava vuoro</h2>

            <div className="rec-basis" aria-label="Mihin suositus perustuu">
              <div className="field">
                <label>Suositus perustuu</label>
                <div className="rec-mode-row" role="radiogroup">
                  {(
                    [
                      ['longest', 'Pisin tauko'],
                      ['topic', 'Aihealue'],
                      ['congregation', 'Seurakunta'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={recMode === mode}
                      className={
                        recMode === mode
                          ? 'rec-mode-btn active'
                          : 'rec-mode-btn'
                      }
                      onClick={() => changeRecMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {recMode === 'topic' && (
                <div className="field">
                  <label htmlFor="rec-topic">Aihealue</label>
                  <select
                    id="rec-topic"
                    value={recTopicCategory ?? ''}
                    onChange={(e) => {
                      const v = e.target.value as ThemeCategoryId | ''
                      clearRecSkips()
                      setRecTopicCategory(v || null)
                    }}
                  >
                    {topicOptions.length === 0 ? (
                      <option value="">Ei aiheita listoilla</option>
                    ) : (
                      topicOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label} ({o.count})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              {recMode === 'congregation' && (
                <div className="field">
                  <label htmlFor="rec-cong">Seurakunta</label>
                  <select
                    id="rec-cong"
                    value={recCongregation ?? ''}
                    onChange={(e) => {
                      clearRecSkips()
                      setRecCongregation(e.target.value || null)
                    }}
                  >
                    {congregationOptions.length === 0 ? (
                      <option value="">Ei seurakuntia listoilla</option>
                    ) : (
                      congregationOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}
            </div>

            <p className="lede">{recLede}</p>

            {!rec && !hasLists ? (
              <div className="empty-state">
                <strong>Listat puuttuvat</strong>
                Selaintyhjeni todennäköisesti, koska tunnelin osoite vaihtui
                (tiedot ovat osoitekohtaisia).
                {cloudMeta ? (
                  <>
                    {' '}
                    Palvelimella on varmuuskopio{' '}
                    {formatCloudBackupWhen(cloudMeta.exportedAt)} (
                    {cloudMeta.lectures} esitelmää, {cloudMeta.speakers}{' '}
                    puhujaa) — palauta se alta.
                  </>
                ) : (
                  <>
                    {' '}
                    Jos teit päivityksiä viimeisimmän .json-varmuuskopion jälkeen
                    vain tässä selaimessa, ne eivät ole palautettavissa
                    palvelimelta. Lataa kierros 6 + historia, tai tuo tiedosto
                    Asetuksista / Lataukset-kansiosta.
                  </>
                )}
                <div className="actions" style={{ justifyContent: 'center' }}>
                  {cloudMeta ? (
                    <button
                      type="button"
                      className="btn btn-accent"
                      disabled={cloudBusy}
                      onClick={() => void restoreCloudBackup()}
                    >
                      Palauta palvelimen varmuuskopio
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={cloudMeta ? 'btn btn-ghost' : 'btn btn-accent'}
                    onClick={() => void loadKierrosList()}
                  >
                    Lataa kierros 6 + historia
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setTab('asetukset')}
                  >
                    Tuo varmuuskopio
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setTab('tuonti')}
                  >
                    Tai tuo omat PDF:t
                  </button>
                </div>
              </div>
            ) : !rec ? (
              <div className="empty-state">
                <strong>Ei sopivaa suositusta</strong>
                {recMode === 'topic'
                  ? ' Valitulle aihealueelle ei löytynyt jäsennystä, jolle olisi vapaa puhuja juuri nyt.'
                  : recMode === 'congregation'
                    ? ' Valitusta seurakunnasta ei löytynyt vapaata puhujaa sopivalle jäsennykselle juuri nyt.'
                    : ' Sopivaa jäsennys–puhuja -paria ei löytynyt juuri nyt (suodattimet, tauot tai skipit).'}
                <div className="actions" style={{ justifyContent: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      clearRecSkips()
                      setData((prev) => ({
                        ...prev,
                        settings: {
                          ...prev.settings,
                          themeSkipCooldown: [],
                          speakerSkipCooldown: [],
                        },
                      }))
                    }}
                  >
                    Nollaa ohitukset
                  </button>
                  {recMode !== 'longest' ? (
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={() => changeRecMode('longest')}
                    >
                      Vaihda pisimpään käyttämättömään
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                <div className="pick-grid">
                  <div className="pick">
                    <div className="pick-label">Jäsennys / teema</div>
                    <div className="pick-value">
                      {rec.theme.number
                        ? `${rec.theme.number}. ${rec.theme.name}`
                        : rec.theme.name}
                    </div>
                    <div className="pick-meta">
                      {formatDaysSince(rec.themeDaysSince)}
                      {rec.theme.lastUsedAt
                        ? ` · ${formatDateFi(rec.theme.lastUsedAt)}`
                        : ''}
                    </div>
                  </div>
                  <div className="pick">
                    <div className="pick-label">Puhuja</div>
                    <div className="pick-value">{rec.speaker.name}</div>
                    <div className="pick-cong">
                      {rec.speaker.congregation.trim()
                        ? rec.speaker.congregation
                        : 'Seurakunta ei tiedossa'}
                    </div>
                    <div className="pick-meta">
                      {formatDaysSince(rec.speakerDaysSince)}
                      {rec.speaker.lastUsedAt
                        ? ` · ${formatDateFi(rec.speaker.lastUsedAt)}`
                        : ''}
                      {` · ${rec.eligibleSpeakerCount} sopivaa puhujaa`}
                      {!rec.speaker.phone ? ' · puhelin puuttuu' : ''}
                      {rec.speaker.snoozeUntil &&
                      rec.speaker.snoozeUntil > todayISO()
                        ? ` · tauolla ${formatDateFi(rec.speaker.snoozeUntil)} asti`
                        : ''}
                    </div>
                  </div>
                  <div className="pick">
                    <div className="pick-label">Puheenjohtaja</div>
                    <div className="pick-value">
                      {recChair?.name ?? '— lisää listalle'}
                    </div>
                    <div className="pick-meta">
                      {recChair
                        ? formatDaysSince(
                            recChair.lastUsedAt
                              ? Math.floor(
                                  (Date.now() -
                                    new Date(
                                      recChair.lastUsedAt + 'T12:00:00',
                                    ).getTime()) /
                                    86400000,
                                )
                              : null,
                          )
                        : 'Ei puheenjohtajia'}
                      {recChair?.phone ? ` · ${recChair.phone}` : ''}
                    </div>
                  </div>
                  <div className="pick">
                    <div className="pick-label">Lukija</div>
                    <div className="pick-value">
                      {recReader?.name ?? '— lisää listalle'}
                    </div>
                    <div className="pick-meta">
                      {recReader
                        ? formatDaysSince(
                            recReader.lastUsedAt
                              ? Math.floor(
                                  (Date.now() -
                                    new Date(
                                      recReader.lastUsedAt + 'T12:00:00',
                                    ).getTime()) /
                                    86400000,
                                )
                              : null,
                          )
                        : 'Ei lukijoita'}
                    </div>
                  </div>
                </div>

                <div className="field-row two" style={{ marginTop: '1rem' }}>
                  <div className="field">
                    <label htmlFor="lecture-date">Esitelmäpäivä (sunnuntai)</label>
                    <input
                      id="lecture-date"
                      type="date"
                      value={lectureDate}
                      onChange={(e) => setLectureDate(e.target.value)}
                    />
                    {dateBooked && bookingOnDate ? (
                      <p className="hint" style={{ color: 'var(--warn)' }}>
                        Tämä päivä on jo varattu (
                        {data.speakers.find(
                          (s) => s.id === bookingOnDate.speakerId,
                        )?.name ?? 'varaus'}
                        ).{' '}
                        <button
                          type="button"
                          className="btn btn-ghost"
                          style={{ padding: '0.2rem 0.5rem' }}
                          onClick={() =>
                            setLectureDate(nextFreeSundayISO(data))
                          }
                        >
                          Siirry seuraavaan vapaaseen
                        </button>
                      </p>
                    ) : (
                      <p className="hint">Seuraava vapaa sunnuntai kalenterissa</p>
                    )}
                  </div>
                  <div className="field">
                    <label>Vaihda suositusta</label>
                    <div className="actions" style={{ marginTop: 0 }}>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setData((prev) =>
                            pushThemeSkipCooldown(prev, rec.theme.id),
                          )
                        }}
                      >
                        Toinen teema
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          const speakerId = rec.speaker.id
                          setSkipSpeakers((s) =>
                            s.includes(speakerId) ? s : [...s, speakerId],
                          )
                          setData((prev) =>
                            pushSpeakerSkipCooldown(prev, speakerId),
                          )
                        }}
                      >
                        Toinen puhuja
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!recChair}
                        onClick={() => {
                          if (!recChair) return
                          setSkipChairs((s) => [...s, recChair.id])
                          setSkipReaders([])
                        }}
                      >
                        Toinen PJ
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!recReader || Boolean(recChair?.alsoReads)}
                        title={
                          recChair?.alsoReads
                            ? 'Puheenjohtaja lukee itse (Lukija-täppä)'
                            : undefined
                        }
                        onClick={() => {
                          if (!recReader || recChair?.alsoReads) return
                          setSkipReaders((s) => [...s, recReader.id])
                        }}
                      >
                        Toinen lukija
                      </button>
                      {(skipThemes.length > 0 ||
                        skipSpeakers.length > 0 ||
                        skipChairs.length > 0 ||
                        skipReaders.length > 0) && (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => {
                            clearRecSkips()
                            setData((prev) => ({
                              ...prev,
                              settings: {
                                ...prev.settings,
                                themeSkipCooldown: [],
                                speakerSkipCooldown: [],
                              },
                            }))
                          }}
                        >
                          Nollaa
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {rec && (
            <aside className="message-box">
              <label htmlFor="wa-message">WhatsApp-viesti</label>
              <textarea
                id="wa-message"
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
              />
              <p className="hint">
                Viesti avataan WhatsAppissa valmiiksi täytettynä. Lähetyksen
                jälkeen päivä merkitään kysytyksi ja suositus siirtyy seuraavaan
                vapaaseen sunnuntaihin, jotta voit kysyä useampia yhtä aikaa.
                Jos varaus poistetaan kalenterista, vapaa aika palaa suositukseen.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={markConfirmedAndOpenWhatsApp}
                  disabled={!rec.speaker.phone}
                >
                  Avaa WhatsApp
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={async () => {
                    await navigator.clipboard.writeText(messageDraft)
                    showToast('Viesti kopioitu')
                  }}
                >
                  Kopioi viesti
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveAsPlanned}
                >
                  Tallenna kysytyksi
                </button>
              </div>
            </aside>
          )}
        </section>
      )}

      {tab === 'kalenteri' && (
        <CalendarView
          data={data}
          setData={setData}
          showToast={showToast}
          onPickDate={(iso) => {
            setLectureDate(iso)
            showToast(`Päiväksi valittu ${formatDateFi(iso)}`)
          }}
          onOpenRecommend={(iso) => {
            setLectureDate(iso)
            setTab('suositus')
          }}
        />
      )}

      {tab === 'tuonti' && (
        <ImportAndFilters
          data={data}
          setData={setData}
          showToast={showToast}
        />
      )}

      {tab === 'teemat' && (
        <section className="panel stack">
          <div>
            <h2 className="section-title">Teemat</h2>
            <p className="lede">
              Lataa CSV (sarakkeet: teema, viimeksi, muistiinpanot) tai lisää
              yksitellen.
            </p>
          </div>
          <div className="toolbar">
            <label className="btn btn-primary file-input">
              Lataa CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => onFile(e, importThemes)}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                downloadText('teemat.csv', themesToCsv(data.themes))
              }
              disabled={!data.themes.length}
            >
              Vie CSV
            </button>
            <ThemeForm
              onSubmit={(t) => {
                addTheme(t)
                showToast('Teema lisätty')
              }}
            />
          </div>
          {!data.themes.length ? (
            <div className="empty-state">
              <strong>Ei teemoja vielä</strong>
              Lataa lista tai lisää ensimmäinen teema.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Nro</th>
                    <th>Teema</th>
                    <th>Viimeksi</th>
                    <th>Jono</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {themeRank.map((t, i) => (
                    <tr key={t.id}>
                      <td>{t.number || '—'}</td>
                      <td>
                        <strong>{t.name}</strong>
                        {t.disabled ? (
                          <div className="hint">ei käytössä</div>
                        ) : null}
                        {t.notes ? (
                          <div className="hint">{t.notes}</div>
                        ) : null}
                      </td>
                      <td>{formatDateFi(t.lastUsedAt)}</td>
                      <td>
                        <span
                          className={`badge ${i === 0 ? 'fresh' : 'stale'}`}
                        >
                          {i === 0
                            ? 'seuraava'
                            : formatDaysSince(
                                t.lastUsedAt
                                  ? Math.floor(
                                      (Date.now() -
                                        new Date(
                                          t.lastUsedAt + 'T12:00:00',
                                        ).getTime()) /
                                        86400000,
                                    )
                                  : null,
                              )}
                        </span>
                      </td>
                      <td>
                        <div className="row-actions">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setEditingTheme(t)}
                          >
                            Muokkaa
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => deleteTheme(t)}
                          >
                            Poista
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'puhujat' && (
        <section className="panel stack">
          <div>
            <h2 className="section-title">Puhujat</h2>
            <p className="lede">
              CSV-sarakkeet: nimi, puhelin, viimeksi, muistiinpanot. Puhelin
              tarvitaan WhatsApp-kutsuun (esim. 0401234567).
            </p>
          </div>
          <div className="toolbar">
            <label className="btn btn-primary file-input">
              Lataa CSV
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => onFile(e, importSpeakers)}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                downloadText('puhujat.csv', speakersToCsv(data.speakers))
              }
              disabled={!data.speakers.length}
            >
              Vie CSV
            </button>
            <SpeakerForm
              onSubmit={(s) => {
                addSpeaker(s)
                showToast('Puhuja lisätty')
              }}
            />
          </div>
          {!data.speakers.length ? (
            <div className="empty-state">
              <strong>Ei puhujia vielä</strong>
              Lataa lista tai lisää ensimmäinen puhuja.
            </div>
          ) : (
            <>
              <div className="list-search">
                <label className="sr-only" htmlFor="speaker-search">
                  Hae puhujia
                </label>
                <input
                  id="speaker-search"
                  type="search"
                  enterKeyHint="search"
                  placeholder="Hae nimellä, seurakunnalla tai teemalla / numerolla…"
                  value={speakerQuery}
                  onChange={(e) => setSpeakerQuery(e.target.value)}
                  autoComplete="off"
                />
                <span className="list-search-count">
                  {speakerQuery.trim()
                    ? `${filteredSpeakers.length} / ${speakerRank.length}`
                    : `${speakerRank.length} puhujaa`}
                </span>
              </div>
              {!filteredSpeakers.length ? (
                <div className="empty-state">
                  <strong>Ei osumia</strong>
                  Kokeile nimeä, seurakuntaa tai teeman numeroa/nimeä.
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Puhuja</th>
                        <th>Seurakunta</th>
                        <th>Puhelin</th>
                        <th>Jäsennykset</th>
                        <th>Saatavuus</th>
                        <th>Viimeksi</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredSpeakers.map((s) => (
                        <tr
                          key={s.id}
                          className={s.unavailable ? 'row-unavailable' : undefined}
                        >
                          <td>
                            <strong>{s.name}</strong>
                            {s.notes ? (
                              <div className="hint">{s.notes}</div>
                            ) : null}
                          </td>
                          <td>{s.congregation || '—'}</td>
                          <td>{s.phone || '—'}</td>
                          <td>
                            <span className="hint">
                              {s.outlines.slice(0, 8).join(' ')}
                              {s.outlines.length > 8
                                ? ` +${s.outlines.length - 8}`
                                : ''}
                            </span>
                          </td>
                          <td>
                            <label className="avail-check">
                              <input
                                type="checkbox"
                                checked={s.unavailable}
                                onChange={(e) => {
                                  const on = e.target.checked
                                  setData((prev) => ({
                                    ...prev,
                                    speakers: prev.speakers.map((sp) =>
                                      sp.id === s.id
                                        ? { ...sp, unavailable: on }
                                        : sp,
                                    ),
                                  }))
                                }}
                              />{' '}
                              Ei käytettävissä
                            </label>
                            {s.unavailable ? (
                              <div className="hint">
                                {s.unavailableReason
                                  ? `Syy: ${s.unavailableReason}`
                                  : 'Ei suositella'}
                              </div>
                            ) : null}
                          </td>
                          <td>{formatDateFi(s.lastUsedAt)}</td>
                          <td>
                            <div className="row-actions">
                              <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setEditingSpeaker(s)}
                              >
                                Muokkaa
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger"
                                onClick={() => deleteSpeaker(s)}
                              >
                                Poista
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'puheenjohtajat' && (
        <>
          <div className="panel" style={{ marginBottom: '0.75rem' }}>
            <div className="actions">
              <button
                type="button"
                className="btn btn-accent"
                onClick={loadSyksyRoles}
              >
                Täydennä syksyn 2026 PJ/lukijat (PDF-lista)
              </button>
            </div>
            <p className="hint" style={{ margin: '0.5rem 0 0' }}>
              Tuo 6.9.–1.11.2026 puheenjohtajat ja lukijat kalenteriin sekä
              merkitsee viimeksi käytetyt päivämäärät suositusta varten.
            </p>
          </div>
          <RolePeopleView
            kind="chairpersons"
            data={data}
            setData={setData}
            showToast={showToast}
          />
        </>
      )}

      {tab === 'lukijat' && (
        <RolePeopleView
          kind="readers"
          data={data}
          setData={setData}
          showToast={showToast}
        />
      )}

      {tab === 'historia' && (
        <section className="panel stack">
          <div>
            <h2 className="section-title">Historia</h2>
            <p className="lede">
              Kun merkitset esitelmän vahvistetuksi tai pidetyksi, teeman,
              puhujan, puheenjohtajan ja lukijan &quot;viimeksi&quot;-päivä
              päivittyy. PDF-listat luodaan välilehdellä PDF-listat.
            </p>
          </div>
          <div className="toolbar">
            <label className="btn btn-primary file-input">
              Tuo Excel-historia
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                onChange={(e) => onFile(e, importExcel)}
              />
            </label>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                void exportSchedulePdf(data, { title: 'Esitelmäohjelma' }).then(
                  () => showToast('Taulukko-PDF ladattu'),
                )
              }}
              disabled={
                !data.lectures.some(
                  (l) => l.status === 'confirmed' || l.status === 'done',
                )
              }
            >
              Vie taulukko-PDF
            </button>
          </div>
          {!data.lectures.length ? (
            <div className="empty-state">
              <strong>Ei tallennettuja esitelmiä</strong>
              Tuo historia Excelistä tai tallenna kysytty Suositus-näkymästä.
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Päivä</th>
                    <th>Teema</th>
                    <th>Puhuja</th>
                    <th>PJ</th>
                    <th>Lukija</th>
                    <th>Tila</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.lectures]
                    .sort((a, b) => b.date.localeCompare(a.date))
                    .map((l) => (
                      <tr key={l.id}>
                        <td>{formatDateFi(l.date)}</td>
                        <td>{themeName(l.themeId)}</td>
                        <td>{speakerName(l.speakerId)}</td>
                        <td>
                          {data.chairpersons.find(
                            (p) => p.id === l.chairpersonId,
                          )?.name ?? '—'}
                        </td>
                        <td>
                          {data.readers.find((p) => p.id === l.readerId)
                            ?.name ?? '—'}
                        </td>
                        <td>
                          <select
                            className={`badge status-${l.status}`}
                            value={
                              l.status === 'deferred'
                                ? 'deferred'
                                : l.status
                            }
                            onChange={(e) => {
                              const v = e.target.value
                              if (v.startsWith('deferred-')) {
                                markDeferred(l.id, Number(v.slice('deferred-'.length)))
                                return
                              }
                              updateLectureStatus(
                                l.id,
                                v as LectureStatus,
                              )
                            }}
                            style={{ border: 'none' }}
                          >
                            <option value="planned">Kysytty</option>
                            <option value="confirmed">Vahvistettu</option>
                            <option value="done">Pidetty</option>
                            <option value="declined">Ei sovi</option>
                            <option value="deferred">Myöhemmin…</option>
                            <option value="deferred-1">↳ 1 kk kuluttua</option>
                            <option value="deferred-2">↳ 2 kk kuluttua</option>
                            <option value="deferred-3">↳ 3 kk kuluttua</option>
                            <option value="deferred-6">↳ 6 kk kuluttua</option>
                          </select>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() =>
                              deleteLecture(
                                l.id,
                                `${formatDateFi(l.date)} · ${speakerName(l.speakerId)}`,
                              )
                            }
                          >
                            Poista
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'pdf-listat' && (
        <PdfListsView data={data} showToast={showToast} />
      )}

      {tab === 'asetukset' && (
        <section className="panel stack">
          <div>
            <h2 className="section-title">Pysyvä osoite</h2>
            <p className="lede">
              Käytä tätä linkkiä ja asenna Vuoro Koti-valikkoon tästä osoitteesta.
              Tilapäisiä trycloudflare-tunnelilinkkejä ei enää tarvita.
            </p>
            <p>
              <a href={PERMANENT_APP_URL}>{PERMANENT_APP_URL}</a>
            </p>
            <div className="actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(PERMANENT_APP_URL).then(
                    () => showToast('Osoite kopioitu'),
                    () => showToast('Kopiointi epäonnistui'),
                  )
                }}
              >
                Kopioi osoite
              </button>
            </div>
          </div>
          <div className="divider" />
          <div>
            <h2 className="section-title">Asenna sovellukseksi</h2>
            <p className="lede">
              Kun Vuoro on Koti-valikossa, se aukeaa ilman selainpalkkia eikä
              kehityspäivitykset hypätä sinua kesken työn.
            </p>
          </div>
          <InstallPrompt force />
          <div className="divider" />
          <LockSettings
            showToast={showToast}
            onLockNow={() => setLockNonce((n) => n + 1)}
          />
          <div className="divider" />
          <UserAdminPanel showToast={showToast} />
          <div className="divider" />
          <div>
            <h2 className="section-title">Siirrä tiedot toiseen laitteeseen</h2>
            <p className="lede">
              Selain ja puhelimen sovellus eivät jaa tallennusta automaattisesti.
              Vie varmuuskopio tietokoneelta ja tuo se tähän laitteeseen —
              historia, kutsut, listat ja asetukset siirtyvät mukana.
            </p>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => {
                void (async () => {
                  try {
                    const backup = await buildBackup(data, { includePdfs: true })
                    downloadBackup(backup)
                    showToast('Varmuuskopio ladattu — siirrä tiedosto puhelimeen')
                  } catch {
                    showToast('Varmuuskopion luonti epäonnistui')
                  }
                })()
              }}
            >
              Vie varmuuskopio (.json)
            </button>
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Tuo varmuuskopio
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (!file) return
                  if (
                    !window.confirm(
                      'Korvataanko tämän laitteen nykyiset tiedot varmuuskopiolla? Tätä ei voi perua.',
                    )
                  ) {
                    return
                  }
                  void (async () => {
                    try {
                      const text = await file.text()
                      const backup = parseBackupJson(text)
                      const next = await applyBackup(backup)
                      setData(next)
                      setSkipSpeakers([])
                      setSkipThemes([])
                      setSkipChairs([])
                      setSkipReaders([])
                      showToast(
                        `Varmuuskopio tuotu (${backup.data.lectures.length} esitelmää, ${backup.data.speakers.length} puhujaa)`,
                      )
                      setTab('suositus')
                    } catch (err) {
                      showToast(
                        err instanceof Error
                          ? err.message
                          : 'Varmuuskopion tuonti epäonnistui',
                      )
                    }
                  })()
                }}
              />
            </label>
          </div>
          <p className="hint">
            Vinkki: lähetä .json-tiedosto itsellesi WhatsAppilla tai AirDropilla,
            avaa se puhelimessa ja tuo Asetuksista.
          </p>
          <div className="divider" />
          <div>
            <h2 className="section-title">Palvelimen varmuuskopio</h2>
            <p className="lede">
              Kun synkronointi on päällä, Vuoro tallentaa kopion palvelimelle.
              Synkronointikoodilla voit palauttaa samat tiedot toisella laitteella.
            </p>
          </div>
          <div className="filter-checks">
            <label>
              <input
                type="checkbox"
                checked={cloudSyncOn}
                onChange={(e) => {
                  const on = e.target.checked
                  setCloudSyncEnabled(on)
                  setCloudSyncOn(on)
                  if (on) {
                    void pushCloudBackup(data).then(() =>
                      fetchCloudBackupMeta().then((meta) => {
                        if (meta) setCloudMeta(meta)
                      }),
                    )
                    showToast('Palvelinsynkronointi päällä')
                  } else {
                    showToast('Palvelinsynkronointi pois')
                  }
                }}
              />{' '}
              Synkronoi automaattisesti palvelimelle
            </label>
          </div>
          <div className="field">
            <label htmlFor="sync-room">Synkronointikoodi (laitteiden välillä)</label>
            <input
              id="sync-room"
              value={syncRoomInput}
              onChange={(e) => {
                const v = e.target.value.trim()
                setSyncRoomInput(e.target.value)
                setSyncRoomId(v || null)
              }}
              onBlur={() => {
                void fetchCloudBackupMeta().then((meta) => setCloudMeta(meta))
              }}
              placeholder="Syntyy automaattisesti ensimmäisessä tallennuksessa"
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {cloudMeta ? (
            <p className="hint">
              Viimeisin palvelinkopio: {formatCloudBackupWhen(cloudMeta.exportedAt)}{' '}
              · {cloudMeta.lectures} esitelmää · {cloudMeta.speakers} puhujaa ·{' '}
              {cloudMeta.themes} teemaa
            </p>
          ) : (
            <p className="hint">Palvelimella ei ole vielä varmuuskopiota.</p>
          )}
          <div className="actions">
            <button
              type="button"
              className="btn btn-accent"
              disabled={cloudBusy || !cloudMeta}
              onClick={() => void restoreCloudBackup()}
            >
              Palauta palvelimen varmuuskopio
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={cloudBusy || !cloudSyncOn}
              onClick={() => {
                void pushCloudBackup(data).then(async (ok) => {
                  if (!ok) {
                    showToast('Synkronointi epäonnistui')
                    return
                  }
                  const meta = await fetchCloudBackupMeta()
                  if (meta) setCloudMeta(meta)
                  const room = getSyncRoomId()
                  if (room) setSyncRoomInput(room)
                  showToast('Tallennettu palvelimelle')
                })
              }}
            >
              Tallenna nyt palvelimelle
            </button>
          </div>
          <div className="divider" />
          <div>
            <h2 className="section-title">Asetukset</h2>
            <p className="lede">
              Muokkaa viestipohjaa. Käytä merkkauksia{' '}
              <code>{'{{nimi}}'}</code>, <code>{'{{numero}}'}</code>,{' '}
              <code>{'{{teema}}'}</code>, <code>{'{{päivä}}'}</code> ja{' '}
              <code>{'{{tapahtuma}}'}</code>.
            </p>
          </div>
          <div className="field">
            <label htmlFor="event-name">Tapahtuman nimi</label>
            <input
              id="event-name"
              value={data.settings.eventName}
              onChange={(e) =>
                setData((prev) => ({
                  ...prev,
                  settings: { ...prev.settings, eventName: e.target.value },
                }))
              }
            />
          </div>
          <div className="field">
            <label htmlFor="template">Viestipohja</label>
            <textarea
              id="template"
              rows={8}
              value={data.settings.messageTemplate}
              onChange={(e) =>
                setData((prev) => ({
                  ...prev,
                  settings: {
                    ...prev.settings,
                    messageTemplate: e.target.value,
                  },
                }))
              }
            />
            <div className="actions" style={{ marginTop: '0.45rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  setData((prev) => ({
                    ...prev,
                    settings: {
                      ...prev.settings,
                      messageTemplate: repairMessageTemplate(''),
                    },
                  }))
                }
              >
                Palauta oletusviesti
              </button>
            </div>
          </div>
          <div className="divider" />
          <div>
            <h2 className="section-title">Tietosuoja (GDPR)</h2>
            <p className="lede">
              Puhujien nimet ja puhelinnumerot ovat henkilötietoja. Vuoro
              käsittelee niitä näin:
            </p>
            <ul className="privacy-list">
              <li>
                <strong>Säilytys:</strong> tiedot pysyvät tässä selaimessa
                (localStorage). Kun palvelinsynkronointi on päällä, kopio
                tallentuu myös tälle Vuoro-palvelimelle tunnelin katkosten varalta.
                Voit suojata avauksen PIN-koodilla / Face ID:llä Asetuksissa.
              </li>
              <li>
                <strong>Käyttötarkoitus:</strong> esitelmien suunnittelu ja
                kutsuminen — ei markkinointia.
              </li>
              <li>
                <strong>Minimointi:</strong> tallenna vain tarvittavat kentät
                (nimi, puhelin, historia). PDF-ohjelmaan eivät mene
                puhelinnumerot.
              </li>
              <li>
                <strong>Poisto-oikeus:</strong> poista yksittäinen puhuja
                Puhujat-välilehdeltä tai tyhjennä kaikki alla (tyhjentää myös
                palvelimen varmuuskopion).
              </li>
              <li>
                <strong>Varmuuskopiot:</strong> Asetukset → Vie varmuuskopio
                siirtää tiedot toiseen laitteeseen. CSV/Excel-viennit ovat myös
                henkilötietoja — säilytä turvallisesti.
              </li>
              <li>
                <strong>Huom:</strong> jos jaat näytön tai tunnelilinkin, muut
                voivat nähdä tietoja. Älä syötä oikeita numeroita julkiseen
                esittelylinkkiin.
              </li>
            </ul>
          </div>
          <div className="divider" />
          <div className="actions">
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                if (
                  window.confirm(
                    'Tyhjennetäänkö kaikki teemat, puhujat, puheenjohtajat, lukijat, historia ja PDF-listat? Tätä ei voi perua.',
                  )
                ) {
                  void clearPdfArchives()
                  void clearCloudBackup().then(() => setCloudMeta(null))
                  setData({
                    themes: [],
                    speakers: [],
                    chairpersons: [],
                    readers: [],
                    lectures: [],
                    settings: data.settings,
                  })
                  setSkipSpeakers([])
                  setSkipThemes([])
                  setSkipChairs([])
                  setSkipReaders([])
                  showToast('Henkilötiedot tyhjennetty tästä selaimesta')
                }
              }}
            >
              Tyhjennä kaikki henkilötiedot
            </button>
          </div>
          <p className="hint">
            Listojen tuonti on Tuonti-välilehdellä. Tämä ei ole juridinen
            neuvonta — organisaationne on rekisterinpitäjä.
          </p>
        </section>
      )}

      {editingTheme && (
        <Modal title="Muokkaa teemaa" onClose={() => setEditingTheme(null)}>
          <ThemeForm
            initial={editingTheme}
            submitLabel="Tallenna"
            onSubmit={(t) =>
              saveThemeEdit({ ...editingTheme, ...t })
            }
          />
        </Modal>
      )}

      {editingSpeaker && (
        <Modal title="Muokkaa puhujaa" onClose={() => setEditingSpeaker(null)}>
          <SpeakerForm
            initial={editingSpeaker}
            submitLabel="Tallenna"
            onSubmit={(s) =>
              saveSpeakerEdit({ ...editingSpeaker, ...s })
            }
          />
        </Modal>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
    </AppLockGate>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

function ThemeForm({
  initial,
  onSubmit,
  submitLabel = 'Lisää teema',
}: {
  initial?: Theme
  onSubmit: (t: Omit<Theme, 'id'>) => void
  submitLabel?: string
}) {
  const [number, setNumber] = useState(initial?.number ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [disabled, setDisabled] = useState(initial?.disabled ?? false)
  const [lastUsedAt, setLastUsedAt] = useState(initial?.lastUsedAt ?? '')
  const retired = isRetiredOutline(number)

  return (
    <form
      className="field-row two"
      style={{ flex: 1, minWidth: '220px' }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        const num = number.trim()
        onSubmit({
          number: num,
          name: name.trim(),
          notes: notes.trim(),
          disabled: retired ? true : disabled,
          lastUsedAt: lastUsedAt || null,
        })
        if (!initial) {
          setNumber('')
          setName('')
          setNotes('')
          setDisabled(false)
          setLastUsedAt('')
        }
      }}
    >
      <div className="field">
        <label>Numero</label>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          placeholder="esim. 54"
        />
      </div>
      <div className="field">
        <label>Teeman nimi</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          placeholder="esim. Vahvista uskoasi..."
        />
      </div>
      <div className="field">
        <label>Viimeksi käytetty</label>
        <input
          type="date"
          value={lastUsedAt}
          onChange={(e) => setLastUsedAt(e.target.value)}
          max={todayISO()}
        />
      </div>
      <div className="field">
        <label>
          <input
            type="checkbox"
            checked={retired || disabled}
            disabled={retired}
            onChange={(e) => setDisabled(e.target.checked)}
          />{' '}
          Ei käytössä
          {retired ? ' (poistettu 1.9.2026)' : ''}
        </label>
      </div>
      {initial && (
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Muistiinpanot</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      )}
      <div className="actions">
        <button type="submit" className="btn btn-ghost">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

function SpeakerForm({
  initial,
  onSubmit,
  submitLabel = 'Lisää puhuja',
}: {
  initial?: Speaker
  onSubmit: (s: Omit<Speaker, 'id'>) => void
  submitLabel?: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [congregation, setCongregation] = useState(initial?.congregation ?? '')
  const [outlines, setOutlines] = useState(
    initial?.outlines.join(' ') ?? '',
  )
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [lastUsedAt, setLastUsedAt] = useState(initial?.lastUsedAt ?? '')
  const [snoozeUntil, setSnoozeUntil] = useState(initial?.snoozeUntil ?? '')
  const [unavailable, setUnavailable] = useState(initial?.unavailable ?? false)
  const [unavailableReason, setUnavailableReason] = useState(
    initial?.unavailableReason ?? '',
  )
  const [localOnly, setLocalOnly] = useState(initial?.localOnly ?? false)
  const [assistant, setAssistant] = useState(initial?.assistant ?? false)

  return (
    <form
      className="stack"
      style={{ flex: 1, minWidth: '220px' }}
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSubmit({
          name: name.trim(),
          phone: phone.trim(),
          congregation: congregation.trim(),
          outlines: [...outlines.matchAll(/S-\d+(?:-\d+)?|\b\d{1,3}\b/g)].map(
            (m) => m[0],
          ),
          notes: notes.trim(),
          localOnly,
          assistant,
          lastUsedAt: lastUsedAt || null,
          snoozeUntil: snoozeUntil || null,
          unavailable,
          unavailableReason: unavailableReason.trim(),
        })
        if (!initial) {
          setName('')
          setPhone('')
          setCongregation('')
          setOutlines('')
          setNotes('')
          setLastUsedAt('')
          setSnoozeUntil('')
          setUnavailable(false)
          setUnavailableReason('')
          setLocalOnly(false)
          setAssistant(false)
        }
      }}
    >
      <div className="field-row two">
        <div className="field">
          <label>Nimi</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="esim. Jani Mustonen"
          />
        </div>
        <div className="field">
          <label>Puhelin</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0400-497 844"
          />
        </div>
        <div className="field">
          <label>Seurakunta</label>
          <input
            value={congregation}
            onChange={(e) => setCongregation(e.target.value)}
            placeholder="Vääksy"
          />
        </div>
        <div className="field">
          <label>Jäsennykset</label>
          <input
            value={outlines}
            onChange={(e) => setOutlines(e.target.value)}
            placeholder="16 54 161 S-31"
          />
        </div>
        <div className="field">
          <label>Viimeksi</label>
          <input
            type="date"
            value={lastUsedAt}
            onChange={(e) => setLastUsedAt(e.target.value)}
            max={todayISO()}
          />
        </div>
        <div className="field">
          <label>Muistiinpanot</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <div className="field">
          <label>Älä suosittele ennen</label>
          <input
            type="date"
            value={snoozeUntil}
            onChange={(e) => setSnoozeUntil(e.target.value)}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={unavailable}
              onChange={(e) => setUnavailable(e.target.checked)}
            />{' '}
            Ei käytettävissä
          </label>
        </div>
        <div className="field">
          <label>Syy</label>
          <input
            value={unavailableReason}
            onChange={(e) => setUnavailableReason(e.target.value)}
            placeholder="esim. muuttaa, sairaus, pyytänyt taukoa"
            disabled={!unavailable}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={localOnly}
              onChange={(e) => setLocalOnly(e.target.checked)}
            />{' '}
            Vain lähiseurakuntiin
          </label>
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={assistant}
              onChange={(e) => setAssistant(e.target.checked)}
            />{' '}
            Avustava palvelija
          </label>
        </div>
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-ghost">
          {submitLabel}
        </button>
      </div>
    </form>
  )
}

