import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppData } from '../types'
import {
  clearPdfArchives,
  deletePdfArchive,
  getPdfArchive,
  kindLabel,
  listPdfArchives,
  savePdfArchive,
  type PdfArchiveMeta,
} from '../lib/pdfArchive'
import {
  buildCongregationSchedulePdf,
  confirmedSchedule,
  downloadBlob,
  formatDateShortFi,
  scheduleRows,
  type SchedulePdfKind,
} from '../lib/pdfExport'

type Props = {
  data: AppData
  showToast: (msg: string) => void
}

type FilterKind = SchedulePdfKind | 'all'

export function PdfListsView({ data, showToast }: Props) {
  const schedule = useMemo(() => confirmedSchedule(data), [data])
  const defaultFrom = schedule[0]?.date ?? ''
  const defaultTo = schedule[schedule.length - 1]?.date ?? ''

  const [kind, setKind] = useState<SchedulePdfKind>('ilmoitustaululle')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState(defaultTo)
  const [historyFilter, setHistoryFilter] = useState<FilterKind>('all')
  const [archives, setArchives] = useState<PdfArchiveMeta[]>([])
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    url: string
    filename: string
    id: string
  } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const rows = await listPdfArchives(
        historyFilter === 'all' ? undefined : historyFilter,
      )
      setArchives(rows)
    } catch {
      showToast('PDF-historian lataus epäonnistui')
    }
  }, [historyFilter, showToast])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    return () => {
      if (preview?.url) URL.revokeObjectURL(preview.url)
    }
  }, [preview?.url])

  // Continue from last Sunday of previous PDF of this kind (overlap one Sunday)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const ofKind = await listPdfArchives(kind)
        if (cancelled) return
        const latest = ofKind[0]
        if (latest?.toDate) {
          setFromDate(latest.toDate)
        } else if (defaultFrom) {
          setFromDate(defaultFrom)
        }
        if (defaultTo) setToDate(defaultTo)
      } catch {
        if (!cancelled && defaultFrom) setFromDate(defaultFrom)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [kind, defaultFrom, defaultTo])

  const previewCount = useMemo(
    () =>
      scheduleRows(data, {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      }).length,
    [data, fromDate, toDate],
  )

  function closePreview() {
    setPreview((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url)
      return null
    })
  }

  async function generate() {
    setBusy(true)
    try {
      const built = await buildCongregationSchedulePdf(data, kind, {
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      })
      if (!built.ok) {
        showToast(built.reason)
        return
      }
      const saved = await savePdfArchive({
        kind: built.kind,
        filename: built.filename,
        fromDate: built.fromDate,
        toDate: built.toDate,
        entryCount: built.entryCount,
        blob: built.blob,
      })
      downloadBlob(built.blob, built.filename)
      const url = URL.createObjectURL(
        built.blob.type === 'application/pdf'
          ? built.blob
          : new Blob([built.blob], { type: 'application/pdf' }),
      )
      setPreview({ url, filename: built.filename, id: saved.id })
      // Next list starts on this list's last Sunday (overlapping continuation)
      setFromDate(built.toDate)
      showToast(`${kindLabel(kind)} tallennettu historiaan`)
      await refresh()
    } catch {
      showToast('PDF:n luonti epäonnistui')
    } finally {
      setBusy(false)
    }
  }

  async function openArchive(id: string) {
    try {
      const entry = await getPdfArchive(id)
      if (!entry) {
        showToast('Tiedostoa ei löytynyt')
        return
      }
      const blob =
        entry.blob.type === 'application/pdf'
          ? entry.blob
          : new Blob([await entry.blob.arrayBuffer()], {
              type: 'application/pdf',
            })
      const url = URL.createObjectURL(blob)
      setPreview((prev) => {
        if (prev?.url) URL.revokeObjectURL(prev.url)
        return { url, filename: entry.filename, id: entry.id }
      })
    } catch {
      showToast('Avaaminen epäonnistui — kokeile Lataa')
    }
  }

  async function downloadArchive(id: string) {
    try {
      const entry = await getPdfArchive(id)
      if (!entry) {
        showToast('Tiedostoa ei löytynyt')
        return
      }
      downloadBlob(entry.blob, entry.filename)
      showToast('PDF ladattu')
    } catch {
      showToast('Lataus epäonnistui')
    }
  }

  async function removeArchive(meta: PdfArchiveMeta) {
    if (
      !window.confirm(
        `Poistetaanko PDF “${meta.filename}” historiasta? Tätä ei voi perua.`,
      )
    ) {
      return
    }
    await deletePdfArchive(meta.id)
    showToast('PDF poistettu historiasta')
    await refresh()
  }

  async function clearHistory() {
    if (
      !window.confirm(
        'Tyhjennetäänkö koko PDF-historia? Tätä ei voi perua.',
      )
    ) {
      return
    }
    await clearPdfArchives()
    showToast('PDF-historia tyhjennetty')
    await refresh()
  }

  return (
    <section className="panel stack">
      <div>
        <h2 className="section-title">PDF-listat</h2>
        <p className="lede">
          Luo ilmoitustaulun tai PJ-listan PDF valitulta aikaväliltä. Generoidut
          listat säilyvät tässä historiassa, josta ne voi avata tai ladata
          myöhemmin.
        </p>
      </div>

      <div className="field-row two">
        <div className="field">
          <label htmlFor="pdf-kind">Listatyyppi</label>
          <select
            id="pdf-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as SchedulePdfKind)}
          >
            <option value="ilmoitustaululle">Ilmoitustaululle (ei puhelimia)</option>
            <option value="PJ">PJ-lista (puheenjohtajien puhelimet)</option>
          </select>
        </div>
        <div className="field">
          <label>Esikatselu</label>
          <p className="hint" style={{ margin: '0.55rem 0 0' }}>
            {previewCount > 0
              ? `${previewCount} vahvistettua / pidettyä esitelmää valitulla välillä`
              : 'Ei esitelmiä valitulla välillä'}
          </p>
        </div>
      </div>

      <div className="field-row two">
        <div className="field">
          <label htmlFor="pdf-from">Alkaen</label>
          <input
            id="pdf-from"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="pdf-to">Asti</label>
          <input
            id="pdf-to"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || previewCount === 0}
          onClick={() => void generate()}
        >
          {busy ? 'Luodaan…' : `Luo ja tallenna ${kindLabel(kind)}`}
        </button>
      </div>

      <div className="divider" />

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'end',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <h3 className="section-title" style={{ fontSize: '1.25rem' }}>
            PDF-historia
          </h3>
          <p className="hint" style={{ margin: 0 }}>
            Tallessa tässä selaimessa (IndexedDB).
          </p>
        </div>
        <div className="field" style={{ minWidth: '12rem' }}>
          <label htmlFor="pdf-hist-filter">Suodata</label>
          <select
            id="pdf-hist-filter"
            value={historyFilter}
            onChange={(e) => setHistoryFilter(e.target.value as FilterKind)}
          >
            <option value="all">Kaikki</option>
            <option value="ilmoitustaululle">Ilmoitustaululle</option>
            <option value="PJ">PJ</option>
          </select>
        </div>
      </div>

      {!archives.length ? (
        <div className="empty-state">
          <strong>Ei tallennettuja PDF-listoja</strong>
          Luo ensimmäinen lista yllä.
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Luotu</th>
                  <th>Tyyppi</th>
                  <th>Aikaväli</th>
                  <th>Rivejä</th>
                  <th>Tiedosto</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {archives.map((a) => (
                  <tr key={a.id}>
                    <td>
                      {new Date(a.createdAt).toLocaleString('fi-FI', {
                        day: 'numeric',
                        month: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td>{kindLabel(a.kind)}</td>
                    <td>
                      {formatDateShortFi(a.fromDate)} –{' '}
                      {formatDateShortFi(a.toDate)}
                    </td>
                    <td>{a.entryCount}</td>
                    <td>
                      <span className="hint">{a.filename}</span>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void openArchive(a.id)}
                        >
                          Avaa
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => void downloadArchive(a.id)}
                        >
                          Lataa
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => void removeArchive(a)}
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
          <div className="actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void clearHistory()}
            >
              Tyhjennä PDF-historia
            </button>
          </div>
        </>
      )}

      {schedule.length === 0 ? (
        <p className="hint">
          Vahvistettuja esitelmiä ei ole vielä — lisää varauksia kalenteriin tai
          merkitse ne Historiassa vahvistetuiksi.
        </p>
      ) : null}

      {preview ? (
        <div
          className="modal-backdrop"
          onClick={closePreview}
          role="presentation"
        >
          <div
            className="modal modal-pdf-preview"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={preview.filename}
          >
            <div className="pdf-preview-header">
              <strong>{preview.filename}</strong>
              <div className="row-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void downloadArchive(preview.id)}
                >
                  Lataa
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={closePreview}
                >
                  Sulje
                </button>
              </div>
            </div>
            <iframe
              className="pdf-preview-frame"
              title={preview.filename}
              src={preview.url}
            />
            <p className="hint" style={{ margin: '0.5rem 0 0' }}>
              Jos esikatselu ei näy (esim. iPhone), käytä Lataa-nappia.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  )
}
