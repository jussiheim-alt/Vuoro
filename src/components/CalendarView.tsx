import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type {
  AppData,
  Lecture,
  LectureEventKind,
  LectureStatus,
  Speaker,
} from '../types'
import {
  EVENT_KIND_LABEL,
  EVENT_KIND_OPTIONS,
  isConventionKind,
  lectureEventKind,
  needsChairperson,
  needsCustomTitle,
  needsReader,
  needsSpeakerAndTheme,
  scheduleTitleForLecture,
  speakersForTheme,
  themesForSpeaker,
} from '../lib/eventKinds'
import {
  createLecture,
  recommendChairAndReader,
  readerForChairperson,
  recomputeLastUsed,
  sundaysCoveringLectures,
} from '../lib/recommend'
import { formatDateFi, themeLabel, uid } from '../lib/storage'

const STATUS_FI: Record<LectureStatus, string> = {
  planned: 'Kysytty',
  confirmed: 'Vahvistettu',
  done: 'Pidetty',
  declined: 'Ei sovi',
  deferred: 'Myöhemmin',
}

type Props = {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  onPickDate: (iso: string) => void
  onOpenRecommend: (iso: string) => void
  showToast: (msg: string) => void
}

type Draft = {
  lectureId: string | null
  date: string
  eventKind: LectureEventKind
  speakerId: string
  themeId: string
  customTitle: string
  chairpersonId: string
  readerId: string
  status: LectureStatus
  notes: string
  deferMonths: number | null
}

export function CalendarView({
  data,
  setData,
  onPickDate,
  onOpenRecommend,
  showToast,
}: Props) {
  const sundays = useMemo(
    () => sundaysCoveringLectures(data, new Date(), 2),
    [data],
  )
  const [draft, setDraft] = useState<Draft | null>(null)
  const [newSpeakerOpen, setNewSpeakerOpen] = useState(false)
  const [newSpeakerName, setNewSpeakerName] = useState('')
  const [newSpeakerPhone, setNewSpeakerPhone] = useState('')
  const [newSpeakerCong, setNewSpeakerCong] = useState('')

  const byDate = useMemo(() => {
    const map = new Map<string, Lecture[]>()
    for (const l of data.lectures) {
      if (l.status === 'declined' || l.status === 'deferred') continue
      const arr = map.get(l.date) ?? []
      arr.push(l)
      map.set(l.date, arr)
    }
    return map
  }, [data.lectures])

  const speakersSorted = useMemo(
    () =>
      [...data.speakers].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    [data.speakers],
  )
  const themesSorted = useMemo(
    () =>
      [...data.themes]
        .filter((t) => !t.disabled || t.number === '—')
        .sort((a, b) => {
          const an = Number(a.number)
          const bn = Number(b.number)
          if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn
          return a.number.localeCompare(b.number, 'fi')
        }),
    [data.themes],
  )
  const chairsSorted = useMemo(
    () =>
      [...data.chairpersons].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    [data.chairpersons],
  )
  const readersSorted = useMemo(
    () =>
      [...data.readers].sort((a, b) => a.name.localeCompare(b.name, 'fi')),
    [data.readers],
  )

  const selectedSpeaker = draft
    ? data.speakers.find((s) => s.id === draft.speakerId) ?? null
    : null
  const selectedTheme = draft
    ? data.themes.find((t) => t.id === draft.themeId) ?? null
    : null

  const filteredThemes = useMemo(() => {
    if (!draft || draft.eventKind !== 'talk') return themesSorted
    return themesForSpeaker(themesSorted, selectedSpeaker, draft.themeId)
  }, [draft, themesSorted, selectedSpeaker])

  const filteredSpeakers = useMemo(() => {
    if (!draft || draft.eventKind !== 'talk') return speakersSorted
    return speakersForTheme(speakersSorted, selectedTheme, draft.speakerId)
  }, [draft, speakersSorted, selectedTheme])

  function themeName(id: string) {
    const t = data.themes.find((x) => x.id === id)
    return t ? themeLabel(t) : '—'
  }
  function speakerName(id: string) {
    const s = data.speakers.find((x) => x.id === id)
    if (!s) return '—'
    return s.congregation ? `${s.name} (${s.congregation})` : s.name
  }
  function roleName(id: string | null | undefined) {
    if (!id) return '—'
    return (
      data.chairpersons.find((p) => p.id === id)?.name ??
      data.readers.find((p) => p.id === id)?.name ??
      '—'
    )
  }

  function openManual(date: string, existing?: Lecture) {
    setNewSpeakerOpen(false)
    setNewSpeakerName('')
    setNewSpeakerPhone('')
    setNewSpeakerCong('')
    const kind = existing ? lectureEventKind(existing) : 'talk'
    const suggested = existing
      ? {
          chairpersonId: existing.chairpersonId ?? '',
          readerId: existing.readerId ?? '',
        }
      : (() => {
          const pair = recommendChairAndReader(data)
          return {
            chairpersonId: pair.chair?.id || chairsSorted[0]?.id || '',
            readerId: pair.reader?.id || readersSorted[0]?.id || '',
          }
        })()
    setDraft({
      lectureId: existing?.id ?? null,
      date,
      eventKind: kind,
      speakerId: existing?.speakerId ?? speakersSorted[0]?.id ?? '',
      themeId: existing?.themeId ?? themesSorted[0]?.id ?? '',
      customTitle: existing?.customTitle ?? '',
      chairpersonId: suggested.chairpersonId,
      readerId: suggested.readerId,
      status: existing?.status ?? 'confirmed',
      notes: existing?.notes ?? '',
      deferMonths: existing?.status === 'deferred' ? 3 : null,
    })
  }

  function changeEventKind(eventKind: LectureEventKind) {
    if (!draft) return
    if (eventKind === draft.eventKind) return
    const pair =
      needsChairperson(eventKind) && !isConventionKind(eventKind)
        ? recommendChairAndReader(data)
        : { chair: null, reader: null }
    setDraft({
      ...draft,
      eventKind,
      speakerId: needsSpeakerAndTheme(eventKind)
        ? draft.speakerId || speakersSorted[0]?.id || ''
        : '',
      themeId: needsSpeakerAndTheme(eventKind)
        ? draft.themeId || themesSorted[0]?.id || ''
        : '',
      customTitle: needsCustomTitle(eventKind) ? draft.customTitle : '',
      chairpersonId: needsChairperson(eventKind)
        ? draft.chairpersonId || pair.chair?.id || chairsSorted[0]?.id || ''
        : '',
      readerId: needsReader(eventKind)
        ? draft.readerId || pair.reader?.id || readersSorted[0]?.id || ''
        : '',
    })
  }

  function changeSpeaker(speakerId: string) {
    if (!draft) return
    const speaker = data.speakers.find((s) => s.id === speakerId) ?? null
    const theme = data.themes.find((t) => t.id === draft.themeId) ?? null
    let themeId = draft.themeId
    if (speaker && theme && theme.number && speaker.outlines.length > 0) {
      if (!speaker.outlines.includes(theme.number)) themeId = ''
    }
    setDraft({ ...draft, speakerId, themeId })
  }

  function changeTheme(themeId: string) {
    if (!draft) return
    const theme = data.themes.find((t) => t.id === themeId) ?? null
    const speaker = data.speakers.find((s) => s.id === draft.speakerId) ?? null
    let speakerId = draft.speakerId
    if (theme && theme.number && theme.number !== '—' && speaker) {
      if (
        speaker.outlines.length > 0 &&
        !speaker.outlines.includes(theme.number)
      ) {
        speakerId = ''
      }
    }
    setDraft({ ...draft, themeId, speakerId })
  }

  function addSpeakerQuick(): Speaker | null {
    const name = newSpeakerName.trim()
    if (!name) {
      showToast('Anna puhujan nimi')
      return null
    }
    const speaker: Speaker = {
      id: uid(),
      name,
      phone: newSpeakerPhone.trim(),
      congregation: newSpeakerCong.trim(),
      outlines: [],
      notes: 'Lisätty kalenterista',
      localOnly: false,
      assistant: false,
      lastUsedAt: null,
      snoozeUntil: null,
      unavailable: false,
      unavailableReason: '',
      onRoster: true,
    }
    setData((prev) => ({
      ...prev,
      speakers: [...prev.speakers, speaker].sort((a, b) =>
        a.name.localeCompare(b.name, 'fi'),
      ),
    }))
    setDraft((d) => (d ? { ...d, speakerId: speaker.id } : d))
    setNewSpeakerOpen(false)
    setNewSpeakerName('')
    setNewSpeakerPhone('')
    setNewSpeakerCong('')
    showToast(`Puhuja ${name} lisätty`)
    return speaker
  }

  function saveDraft() {
    if (!draft) return
    const kind = draft.eventKind

    if (needsSpeakerAndTheme(kind)) {
      if (!draft.speakerId || !draft.themeId) {
        showToast('Valitse puhuja ja teema')
        return
      }
    }
    if (needsChairperson(kind) && !isConventionKind(kind) && !draft.chairpersonId) {
      showToast('Valitse puheenjohtaja')
      return
    }

    const speakerId = needsSpeakerAndTheme(kind) ? draft.speakerId : ''
    const themeId = needsSpeakerAndTheme(kind) ? draft.themeId : ''
    const chairpersonId = needsChairperson(kind) ? draft.chairpersonId || null : null
    const readerId = needsReader(kind) ? draft.readerId || null : null
    const customTitle = needsCustomTitle(kind) ? draft.customTitle.trim() : ''

    setData((prev) => {
      let next = prev
      if (draft.lectureId) {
        const lectures = prev.lectures.map((l) =>
          l.id === draft.lectureId
            ? {
                ...l,
                date: draft.date,
                speakerId,
                themeId,
                chairpersonId,
                readerId,
                status: draft.status,
                notes: draft.notes,
                eventKind: kind,
                customTitle,
              }
            : l,
        )
        next = { ...prev, lectures }
      } else {
        const lecture = createLecture(
          themeId,
          speakerId,
          draft.date,
          draft.status,
          {
            chairpersonId,
            readerId,
            eventKind: kind,
            customTitle,
            notes: draft.notes || 'Lisätty käsin kalenterista',
          },
        )
        next = {
          ...prev,
          lectures: [lecture, ...prev.lectures],
        }
      }

      if (
        kind === 'talk' &&
        draft.status === 'deferred' &&
        draft.deferMonths &&
        speakerId
      ) {
        const until = (() => {
          const d = new Date()
          d.setMonth(d.getMonth() + draft.deferMonths!)
          return d.toISOString().slice(0, 10)
        })()
        next = {
          ...next,
          speakers: next.speakers.map((s) =>
            s.id === speakerId ? { ...s, snoozeUntil: until } : s,
          ),
        }
      }

      return recomputeLastUsed(next)
    })
    showToast(draft.lectureId ? 'Varaus päivitetty' : 'Varaus lisätty kalenteriin')
    setDraft(null)
  }

  function removeDraftLecture() {
    if (!draft?.lectureId) return
    if (
      !window.confirm(
        'Poistetaanko tämä varaus kalenterista? Tätä ei voi perua.',
      )
    ) {
      return
    }
    setData((prev) =>
      recomputeLastUsed({
        ...prev,
        lectures: prev.lectures.filter((l) => l.id !== draft.lectureId),
      }),
    )
    showToast('Varaus poistettu')
    setDraft(null)
  }

  return (
    <section className="panel stack">
      <div>
        <h2 className="section-title">Kalenteri</h2>
        <p className="lede">
          Sunnuntait tältä ja seuraavilta vuosilta. Voit lisätä esitelmän,
          konventin, kierrosviikon tai muistojuhlan käsin, tai pyytää suositusta.
        </p>
      </div>
      <div className="cal-list">
        {sundays.map((date) => {
          const items = (byDate.get(date) ?? []).sort((a, b) =>
            a.status.localeCompare(b.status),
          )
          const primary = items[0]
          const kind = primary ? lectureEventKind(primary) : 'talk'
          const title = primary
            ? scheduleTitleForLecture(primary, themeName(primary.themeId))
            : ''
          return (
            <article key={date} className="cal-card">
              <div className="cal-card-top">
                <div>
                  <strong className="cal-date">{formatDateFi(date)}</strong>
                  <div className="hint">
                    {new Date(date + 'T12:00:00').toLocaleDateString('fi-FI', {
                      weekday: 'long',
                    })}
                  </div>
                </div>
                {primary ? (
                  <span className={`badge status-${primary.status}`}>
                    {kind === 'talk'
                      ? STATUS_FI[primary.status]
                      : EVENT_KIND_LABEL[kind]}
                  </span>
                ) : (
                  <span className="badge fresh">vapaa</span>
                )}
              </div>

              <div className="cal-card-body">
                {primary ? (
                  kind === 'talk' ? (
                    <>
                      <strong>{speakerName(primary.speakerId)}</strong>
                      <div className="hint">{title}</div>
                      <div className="hint">
                        PJ: {roleName(primary.chairpersonId)} · Lukija:{' '}
                        {roleName(primary.readerId)}
                      </div>
                    </>
                  ) : isConventionKind(kind) ? (
                    <strong>{EVENT_KIND_LABEL[kind]}</strong>
                  ) : (
                    <>
                      <strong>{EVENT_KIND_LABEL[kind]}</strong>
                      <div className="hint">{title}</div>
                      <div className="hint">
                        PJ: {roleName(primary.chairpersonId)}
                      </div>
                    </>
                  )
                ) : (
                  <span className="hint">Ei varausta</span>
                )}
              </div>

              <div className="cal-card-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openManual(date, primary)}
                >
                  {primary ? 'Muokkaa' : 'Lisää käsin'}
                </button>
                {!primary ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => onOpenRecommend(date)}
                  >
                    Ehdota
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => onPickDate(date)}
                >
                  Valitse pvm
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {draft &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => setDraft(null)}
            role="presentation"
          >
            <div
              className="modal modal-calendar"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3>
                {draft.lectureId ? 'Muokkaa varausta' : 'Lisää varaus käsin'}
              </h3>
              <div className="stack">
                <div className="field">
                  <label htmlFor="cal-date">Päivä</label>
                  <input
                    id="cal-date"
                    type="date"
                    value={draft.date}
                    onChange={(e) =>
                      setDraft({ ...draft, date: e.target.value })
                    }
                  />
                </div>

                <div className="field">
                  <label htmlFor="cal-kind">Tyyppi</label>
                  <select
                    id="cal-kind"
                    value={draft.eventKind}
                    onChange={(e) =>
                      changeEventKind(e.target.value as LectureEventKind)
                    }
                  >
                    {EVENT_KIND_OPTIONS.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                {needsSpeakerAndTheme(draft.eventKind) ? (
                  <>
                    <div className="field">
                      <label htmlFor="cal-speaker">Puhuja</label>
                      <select
                        id="cal-speaker"
                        value={draft.speakerId}
                        onChange={(e) => changeSpeaker(e.target.value)}
                      >
                        <option value="">— valitse puhuja —</option>
                        {filteredSpeakers.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                            {s.congregation ? ` (${s.congregation})` : ''}
                          </option>
                        ))}
                      </select>
                      {draft.themeId && filteredSpeakers.length === 0 ? (
                        <p className="hint">
                          Ei puhujia joilla tämä jäsennys on listalla.
                        </p>
                      ) : null}
                      <div className="actions" style={{ marginTop: '0.45rem' }}>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setNewSpeakerOpen((v) => !v)}
                        >
                          {newSpeakerOpen
                            ? 'Sulje uusi puhuja'
                            : 'Lisää uusi puhuja'}
                        </button>
                      </div>
                      {newSpeakerOpen ? (
                        <div className="stack" style={{ marginTop: '0.55rem' }}>
                          <div className="field">
                            <label>Nimi</label>
                            <input
                              value={newSpeakerName}
                              onChange={(e) => setNewSpeakerName(e.target.value)}
                              placeholder="Etunimi Sukunimi"
                            />
                          </div>
                          <div className="field">
                            <label>Puhelin</label>
                            <input
                              value={newSpeakerPhone}
                              onChange={(e) => setNewSpeakerPhone(e.target.value)}
                              placeholder="040..."
                            />
                          </div>
                          <div className="field">
                            <label>Seurakunta</label>
                            <input
                              value={newSpeakerCong}
                              onChange={(e) => setNewSpeakerCong(e.target.value)}
                            />
                          </div>
                          <div className="actions">
                            <button
                              type="button"
                              className="btn btn-accent"
                              onClick={() => addSpeakerQuick()}
                            >
                              Tallenna puhuja
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="field">
                      <label htmlFor="cal-theme">Teema / jäsennys</label>
                      <select
                        id="cal-theme"
                        value={draft.themeId}
                        onChange={(e) => changeTheme(e.target.value)}
                      >
                        <option value="">— valitse teema —</option>
                        {filteredThemes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {themeLabel(t)}
                          </option>
                        ))}
                      </select>
                      {draft.speakerId && filteredThemes.length === 0 ? (
                        <p className="hint">
                          Tällä puhujalla ei ole listattuja jäsennyksiä — tai ne
                          on poistettu käytöstä.
                        </p>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {needsCustomTitle(draft.eventKind) ? (
                  <div className="field">
                    <label htmlFor="cal-custom-title">Teeman nimi</label>
                    <input
                      id="cal-custom-title"
                      value={draft.customTitle}
                      onChange={(e) =>
                        setDraft({ ...draft, customTitle: e.target.value })
                      }
                      placeholder={
                        draft.eventKind === 'memorial'
                          ? 'esim. Muistojuhlapuhe'
                          : 'esim. Kierrosviikon teema'
                      }
                    />
                  </div>
                ) : null}

                {isConventionKind(draft.eventKind) ? (
                  <p className="hint">
                    Konventille merkitään vain päivämäärä. Se tulee PDF-listalle
                    ilman puhujaa, teemaa, puheenjohtajaa tai lukijaa.
                  </p>
                ) : null}

                {needsChairperson(draft.eventKind) ? (
                  <div className="field-row two">
                    <div className="field">
                      <label htmlFor="cal-chair">Puheenjohtaja</label>
                      <select
                        id="cal-chair"
                        value={draft.chairpersonId}
                        onChange={(e) => {
                          const chairpersonId = e.target.value
                          const chair =
                            chairsSorted.find((p) => p.id === chairpersonId) ??
                            null
                          const reader = needsReader(draft.eventKind)
                            ? readerForChairperson(data, chair)
                            : null
                          setDraft({
                            ...draft,
                            chairpersonId,
                            readerId: needsReader(draft.eventKind)
                              ? reader?.id ?? ''
                              : '',
                          })
                        }}
                      >
                        <option value="">—</option>
                        {chairsSorted.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {needsReader(draft.eventKind) ? (
                      <div className="field">
                        <label htmlFor="cal-reader">Lukija</label>
                        <select
                          id="cal-reader"
                          value={draft.readerId}
                          onChange={(e) =>
                            setDraft({ ...draft, readerId: e.target.value })
                          }
                        >
                          <option value="">—</option>
                          {readersSorted.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="field">
                        <label>Lukija</label>
                        <p className="hint">Ei lukijaa tälle tyypille</p>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="field">
                  <label htmlFor="cal-status">Tila</label>
                  <select
                    id="cal-status"
                    value={
                      draft.status === 'deferred' && draft.deferMonths
                        ? `deferred-${draft.deferMonths}`
                        : draft.status
                    }
                    onChange={(e) => {
                      const v = e.target.value
                      if (v.startsWith('deferred-')) {
                        const months = Number(v.slice('deferred-'.length))
                        setDraft({
                          ...draft,
                          status: 'deferred',
                          deferMonths: months,
                          notes: /Palataan ~\d+ kk/.test(draft.notes)
                            ? draft.notes.replace(
                                /Palataan ~\d+ kk/,
                                `Palataan ~${months} kk`,
                              )
                            : draft.notes
                              ? `${draft.notes} · Palataan ~${months} kk`
                              : `Palataan ~${months} kk`,
                        })
                        return
                      }
                      setDraft({
                        ...draft,
                        status: v as LectureStatus,
                        deferMonths:
                          v === 'deferred' ? draft.deferMonths ?? 3 : null,
                      })
                    }}
                  >
                    <option value="planned">Kysytty</option>
                    <option value="confirmed">Vahvistettu</option>
                    <option value="done">Pidetty</option>
                    <option value="declined">Ei sovi</option>
                    {draft.eventKind === 'talk' ? (
                      <>
                        <option value="deferred-1">Myöhemmin (1 kk)</option>
                        <option value="deferred-2">Myöhemmin (2 kk)</option>
                        <option value="deferred-3">Myöhemmin (3 kk)</option>
                        <option value="deferred-6">Myöhemmin (6 kk)</option>
                      </>
                    ) : null}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cal-notes">Muistiinpano</label>
                  <input
                    id="cal-notes"
                    value={draft.notes}
                    onChange={(e) =>
                      setDraft({ ...draft, notes: e.target.value })
                    }
                    placeholder="vapaaehtoinen muistiinpano"
                  />
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveDraft}
                  >
                    Tallenna
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setDraft(null)}
                  >
                    Peruuta
                  </button>
                  {draft.lectureId ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={removeDraftLecture}
                    >
                      Poista
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  )
}
