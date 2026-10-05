import { useState, type Dispatch, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import type { AppData, RolePerson } from '../types'
import {
  daysSince,
  formatDateFi,
  formatDaysSince,
  uid,
} from '../lib/storage'

type Kind = 'chairpersons' | 'readers'

type Props = {
  kind: Kind
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  showToast: (msg: string) => void
}

const LABELS: Record<
  Kind,
  { title: string; singular: string; empty: string; lede: string }
> = {
  chairpersons: {
    title: 'Puheenjohtajat',
    singular: 'puheenjohtaja',
    empty: 'Ei puheenjohtajia vielä',
    lede: 'Lisää puheenjohtajat. Jos “Lukija”-täppä on päällä, sama henkilö lukee omalla vuorollaan. Ilman täppää lukija valitaan lukijalistasta vuorojärjestyksessä.',
  },
  readers: {
    title: 'Lukijat',
    singular: 'lukija',
    empty: 'Ei lukijoita vielä',
    lede: 'Lisää lukijat. Käytetään, kun puheenjohtajalla ei ole “Lukija”-täppää (esim. Mika Färlin, Jussi Heimonen).',
  },
}

function normName(name: string): string {
  return name.trim().toLowerCase()
}

/** Ensure a matching reader exists when chair also reads. */
function ensureReaderEntry(
  prev: AppData,
  chair: RolePerson,
): AppData['readers'] {
  const key = normName(chair.name)
  if (prev.readers.some((r) => normName(r.name) === key)) {
    return prev.readers
  }
  return [
    ...prev.readers,
    {
      id: uid(),
      name: chair.name,
      phone: chair.phone,
      notes: 'Lisätty puheenjohtajan Lukija-täpästä',
      lastUsedAt: null,
      alsoReads: false,
    },
  ].sort((a, b) => a.name.localeCompare(b.name, 'fi'))
}

export function RolePeopleView({ kind, data, setData, showToast }: Props) {
  const meta = LABELS[kind]
  const people = data[kind]
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [alsoReads, setAlsoReads] = useState(true)
  const [editing, setEditing] = useState<RolePerson | null>(null)

  function addPerson() {
    const n = name.trim()
    if (!n) {
      showToast(`Anna ${meta.singular}n nimi`)
      return
    }
    if (people.some((p) => p.name.toLowerCase() === n.toLowerCase())) {
      showToast('Nimi on jo listalla')
      return
    }
    const person: RolePerson = {
      id: uid(),
      name: n,
      phone: phone.trim(),
      notes: '',
      lastUsedAt: null,
      alsoReads: kind === 'chairpersons' ? alsoReads : false,
    }
    setData((prev) => {
      let readers = prev.readers
      const list = [...prev[kind], person].sort((a, b) =>
        a.name.localeCompare(b.name, 'fi'),
      )
      let next: AppData = { ...prev, [kind]: list }
      if (kind === 'chairpersons' && person.alsoReads) {
        readers = ensureReaderEntry(next, person)
        next = { ...next, readers }
      }
      return next
    })
    setName('')
    setPhone('')
    setAlsoReads(true)
    showToast(`${n} lisätty`)
  }

  function toggleAlsoReads(person: RolePerson, value: boolean) {
    setData((prev) => {
      const chairpersons = prev.chairpersons.map((p) =>
        p.id === person.id ? { ...p, alsoReads: value } : p,
      )
      let next: AppData = { ...prev, chairpersons }
      if (value) {
        const updated = chairpersons.find((p) => p.id === person.id)!
        next = { ...next, readers: ensureReaderEntry(next, updated) }
      }
      return next
    })
  }

  function saveEdit() {
    if (!editing) return
    const n = editing.name.trim()
    if (!n) {
      showToast('Nimi vaaditaan')
      return
    }
    setData((prev) => {
      const updated: RolePerson = {
        ...editing,
        name: n,
        phone: editing.phone.trim(),
      }
      const list = prev[kind]
        .map((p) => (p.id === editing.id ? updated : p))
        .sort((a, b) => a.name.localeCompare(b.name, 'fi'))
      let next: AppData = { ...prev, [kind]: list }
      if (kind === 'chairpersons' && updated.alsoReads) {
        next = { ...next, readers: ensureReaderEntry(next, updated) }
      }
      return next
    })
    setEditing(null)
    showToast('Tallennettu')
  }

  function removePerson(person: RolePerson) {
    if (
      !window.confirm(
        `Poistetaanko ${meta.singular} “${person.name}”? Tätä ei voi perua.`,
      )
    ) {
      return
    }
    setData((prev) => ({
      ...prev,
      [kind]: prev[kind].filter((p) => p.id !== person.id),
      lectures: prev.lectures.map((l) => {
        if (kind === 'chairpersons' && l.chairpersonId === person.id) {
          return { ...l, chairpersonId: null }
        }
        if (kind === 'readers' && l.readerId === person.id) {
          return { ...l, readerId: null }
        }
        return l
      }),
    }))
    showToast('Poistettu')
  }

  const ranked = [...people].sort((a, b) => {
    if (a.lastUsedAt === null && b.lastUsedAt === null) {
      return a.name.localeCompare(b.name, 'fi')
    }
    if (a.lastUsedAt === null) return -1
    if (b.lastUsedAt === null) return 1
    return a.lastUsedAt.localeCompare(b.lastUsedAt)
  })

  return (
    <section className="panel stack">
      <div>
        <h2 className="section-title">{meta.title}</h2>
        <p className="lede">{meta.lede}</p>
      </div>

      <div className="field-row two">
        <div className="field">
          <label>Nimi</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Etunimi Sukunimi"
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPerson()
            }}
          />
        </div>
        <div className="field">
          <label>Puhelin (valinnainen)</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="040..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') addPerson()
            }}
          />
        </div>
      </div>
      {kind === 'chairpersons' ? (
        <label className="hint" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={alsoReads}
            onChange={(e) => setAlsoReads(e.target.checked)}
          />
          Lukija (lukee myös omalla puheenjohtajavuorollaan)
        </label>
      ) : null}
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={addPerson}>
          Lisää {meta.singular}
        </button>
      </div>

      {!ranked.length ? (
        <div className="empty-state">
          <strong>{meta.empty}</strong>
          Lisää ensimmäinen henkilö yllä.
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nimi</th>
                <th>Puhelin</th>
                {kind === 'chairpersons' ? <th>Lukija</th> : null}
                <th>Viimeksi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong>{p.name}</strong>
                  </td>
                  <td>{p.phone || '—'}</td>
                  {kind === 'chairpersons' ? (
                    <td>
                      <input
                        type="checkbox"
                        checked={p.alsoReads}
                        title="Lukee omalla puheenjohtajavuorollaan"
                        aria-label={`Lukija: ${p.name}`}
                        onChange={(e) => toggleAlsoReads(p, e.target.checked)}
                      />
                    </td>
                  ) : null}
                  <td>
                    <span className="hint">
                      {formatDaysSince(daysSince(p.lastUsedAt))}
                      {p.lastUsedAt ? ` · ${formatDateFi(p.lastUsedAt)}` : ''}
                    </span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setEditing({ ...p })}
                      >
                        Muokkaa
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => removePerson(p)}
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

      {editing &&
        createPortal(
          <div
            className="modal-backdrop"
            onClick={() => setEditing(null)}
            role="presentation"
          >
            <div
              className="modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
            >
              <h3>Muokkaa</h3>
              <div className="stack">
                <div className="field">
                  <label>Nimi</label>
                  <input
                    value={editing.name}
                    onChange={(e) =>
                      setEditing({ ...editing, name: e.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Puhelin</label>
                  <input
                    value={editing.phone}
                    onChange={(e) =>
                      setEditing({ ...editing, phone: e.target.value })
                    }
                  />
                </div>
                {kind === 'chairpersons' ? (
                  <label
                    className="hint"
                    style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
                  >
                    <input
                      type="checkbox"
                      checked={editing.alsoReads}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          alsoReads: e.target.checked,
                        })
                      }
                    />
                    Lukija (lukee myös omalla puheenjohtajavuorollaan)
                  </label>
                ) : null}
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveEdit}
                  >
                    Tallenna
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditing(null)}
                  >
                    Peruuta
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  )
}
