import { useEffect, useState } from 'react'

export type VuoroAccount = {
  id: string
  username: string
  role: 'admin' | 'user'
  createdAt: string
}

export type VuoroMe = {
  auth: boolean
  user: VuoroAccount | null
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
    credentials: 'same-origin',
  })
  const json = (await res.json().catch(() => ({}))) as T & {
    ok?: boolean
    reason?: string
  }
  if (!res.ok) {
    const reason = json.reason || `http-${res.status}`
    throw new Error(reason)
  }
  return json
}

export async function fetchMe(): Promise<VuoroMe> {
  try {
    const json = await apiJson<VuoroMe & { ok: boolean }>('/api/me')
    return { auth: !!json.auth, user: json.user ?? null }
  } catch {
    return { auth: false, user: null }
  }
}

type Props = {
  showToast: (msg: string) => void
}

export function UserAdminPanel({ showToast }: Props) {
  const [me, setMe] = useState<VuoroMe | null>(null)
  const [users, setUsers] = useState<VuoroAccount[]>([])
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')

  async function refresh() {
    const nextMe = await fetchMe()
    setMe(nextMe)
    if (nextMe.user?.role === 'admin') {
      try {
        const json = await apiJson<{ users: VuoroAccount[] }>('/api/users')
        setUsers(json.users || [])
      } catch {
        setUsers([])
      }
    } else {
      setUsers([])
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  if (!me) return null

  // Site auth not configured (local/dev without server users)
  if (!me.auth) return null

  return (
    <div>
      <h2 className="section-title">Käyttäjät</h2>
      <p className="lede">
        Kirjautunut:{' '}
        <strong>{me.user?.username ?? '—'}</strong>
        {me.user?.role === 'admin' ? ' (ylläpitäjä)' : ''}.
        Voit kirjautua ulos alta.
      </p>
      <div className="actions" style={{ marginBottom: '0.85rem' }}>
        <a className="btn btn-ghost" href="/__vuoro_logout">
          Kirjaudu ulos
        </a>
      </div>

      {me.user?.role === 'admin' && (
        <>
          <p className="lede">
            Lisää henkilöille omat tunnukset. Jokainen kirjautuu omalla
            käyttäjänimellä ja salasanalla.
          </p>
          <div className="field-row two">
            <div className="field">
              <label htmlFor="new-user">Käyttäjätunnus</label>
              <input
                id="new-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="field">
              <label htmlFor="new-pass">Salasana</label>
              <input
                id="new-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="new-role">Rooli</label>
            <select
              id="new-role"
              value={role}
              onChange={(e) =>
                setRole(e.target.value === 'admin' ? 'admin' : 'user')
              }
            >
              <option value="user">Käyttäjä</option>
              <option value="admin">Ylläpitäjä</option>
            </select>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-accent"
              disabled={busy || username.trim().length < 2 || password.length < 6}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  try {
                    await apiJson('/api/users', {
                      method: 'POST',
                      body: JSON.stringify({
                        username: username.trim(),
                        password,
                        role,
                      }),
                    })
                    setUsername('')
                    setPassword('')
                    setRole('user')
                    showToast('Käyttäjä lisätty')
                    await refresh()
                  } catch (err) {
                    const reason = err instanceof Error ? err.message : ''
                    showToast(
                      reason === 'exists'
                        ? 'Tunnus on jo käytössä'
                        : reason === 'bad-password'
                          ? 'Salasanan pitää olla vähintään 6 merkkiä'
                          : 'Käyttäjän lisäys epäonnistui',
                    )
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Lisää käyttäjä
            </button>
          </div>

          {users.length > 0 && (
            <div className="table-wrap" style={{ marginTop: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Tunnus</th>
                    <th>Rooli</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.username}</td>
                      <td>{u.role === 'admin' ? 'Ylläpitäjä' : 'Käyttäjä'}</td>
                      <td>
                        <div className="actions" style={{ justifyContent: 'flex-end' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={busy}
                            onClick={() => {
                              const next = window.prompt(
                                `Uusi salasana käyttäjälle ${u.username} (vähintään 6 merkkiä):`,
                              )
                              if (!next) return
                              void (async () => {
                                setBusy(true)
                                try {
                                  await apiJson(`/api/users/${u.id}/password`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ password: next }),
                                  })
                                  showToast('Salasana vaihdettu')
                                } catch {
                                  showToast('Salasanan vaihto epäonnistui')
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }}
                          >
                            Vaihda salasana
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger"
                            disabled={busy || u.id === me.user?.id}
                            onClick={() => {
                              if (
                                !window.confirm(
                                  `Poistetaanko käyttäjä ${u.username}?`,
                                )
                              ) {
                                return
                              }
                              void (async () => {
                                setBusy(true)
                                try {
                                  await apiJson(`/api/users/${u.id}`, {
                                    method: 'DELETE',
                                  })
                                  showToast('Käyttäjä poistettu')
                                  await refresh()
                                } catch (err) {
                                  const reason =
                                    err instanceof Error ? err.message : ''
                                  showToast(
                                    reason === 'last-admin'
                                      ? 'Viimeistä ylläpitäjää ei voi poistaa'
                                      : 'Poisto epäonnistui',
                                  )
                                } finally {
                                  setBusy(false)
                                }
                              })()
                            }}
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
    </div>
  )
}
